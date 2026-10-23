// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ExtensionState } from '../api/extensions';

const loadSubscriptions = vi.fn(async () => undefined);
const silentRefresh = vi.fn(async () => undefined);

vi.mock('./feedStore', () => ({
  useFeedStore: { getState: () => ({ loadSubscriptions, silentRefresh }) },
}));
vi.mock('./uiStore', () => ({
  useUiStore: { getState: () => ({ pushToast: vi.fn() }) },
}));
vi.mock('../api/extensions', async () => {
  const actual = await vi.importActual<typeof import('../api/extensions')>('../api/extensions');
  return {
    ...actual,
    fetchExtensionState: vi.fn(),
    setHiddenView: vi.fn(),
    setFavoritesView: vi.fn(),
    setCategoryHidden: vi.fn(),
    setCategoryFavorite: vi.fn(),
  };
});

const api = await import('../api/extensions');
const { useExtensionStore } = await import('./extensionStore');

const hiddenState = (over: Partial<ExtensionState['hiddenCategories']> = {}) => ({
  available: true,
  mode: 'light' as const,
  view: 'hidden' as const,
  effectiveView: 'hidden' as const,
  hiddenIds: [1],
  locked: false,
  hasPasscode: true,
  categories: [
    { id: 1, name: 'Secret', hidden: true },
    { id: 2, name: 'Tech', hidden: false },
  ],
  ...over,
});

const favoritesState = (over: Partial<ExtensionState['favorites']> = {}) => ({
  available: true,
  view: 'all' as const,
  ids: [2],
  categories: [
    { id: 1, name: 'Secret', favorite: false },
    { id: 2, name: 'Tech', favorite: true },
  ],
  ...over,
});

const state = (hidden = hiddenState(), favorites = favoritesState()): ExtensionState => ({
  hiddenCategories: hidden,
  favorites,
});

beforeEach(() => {
  vi.clearAllMocks();
  useExtensionStore.getState().reset();
});

describe('lecture initiale', () => {
  it('adopte l’état renvoyé par la passerelle', async () => {
    vi.mocked(api.fetchExtensionState).mockResolvedValueOnce(state());
    await useExtensionStore.getState().load();
    expect(useExtensionStore.getState().hidden?.hiddenIds).toEqual([1]);
    expect(useExtensionStore.getState().favorites?.ids).toEqual([2]);
    expect(useExtensionStore.getState().loading).toBe(false);
  });

  it('reste muette quand la passerelle est absente', async () => {
    vi.mocked(api.fetchExtensionState).mockRejectedValueOnce(new Error('404'));
    await useExtensionStore.getState().load();
    // Extension non installée : pas d'erreur affichée, pas de bouton.
    expect(useExtensionStore.getState().hidden).toBeNull();
    expect(useExtensionStore.getState().favorites).toBeNull();
    expect(loadSubscriptions).not.toHaveBeenCalled();
  });
});

describe('cycle de l’œil', () => {
  it('envoie la vue suivante et relit le serveur ensuite', async () => {
    vi.mocked(api.setHiddenView).mockResolvedValueOnce({
      changed: true,
      state: state(hiddenState({ view: 'revealed', effectiveView: 'revealed' })),
    });
    await useExtensionStore.getState().load();
    vi.mocked(api.fetchExtensionState).mockResolvedValueOnce(state());
    await useExtensionStore.getState().load();

    await useExtensionStore.getState().cycleHidden();

    expect(api.setHiddenView).toHaveBeenCalledWith('revealed');
    // La synchronisation relit les abonnements PUIS la vue courante, sans
    // déclencher de collecte de flux.
    expect(loadSubscriptions).toHaveBeenCalledTimes(1);
    expect(silentRefresh).toHaveBeenCalledTimes(1);
    expect(useExtensionStore.getState().hidden?.effectiveView).toBe('revealed');
    expect(useExtensionStore.getState().pendingHidden).toBe(false);
  });

  it('ne fait rien quand le verrou est armé', async () => {
    vi.mocked(api.fetchExtensionState).mockResolvedValueOnce(state(hiddenState({ locked: true })));
    await useExtensionStore.getState().load();
    await useExtensionStore.getState().cycleHidden();
    expect(api.setHiddenView).not.toHaveBeenCalled();
  });
});

describe('réponses périmées', () => {
  it('ignore la réponse lente quand un second clic est parti', async () => {
    vi.mocked(api.fetchExtensionState).mockResolvedValueOnce(state());
    await useExtensionStore.getState().load();

    let resolveFirst: (value: { changed: boolean; state: ExtensionState }) => void = () => {};
    const first = new Promise<{ changed: boolean; state: ExtensionState }>((resolve) => {
      resolveFirst = resolve;
    });
    vi.mocked(api.setHiddenView)
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce({
        changed: true,
        state: state(hiddenState({ view: 'only', effectiveView: 'only' })),
      });

    const clickOne = useExtensionStore.getState().cycleHidden();
    const clickTwo = useExtensionStore.getState().cycleHidden();
    await clickTwo;

    // La première requête revient après coup : elle ne doit plus rien écrire.
    resolveFirst({ changed: true, state: state(hiddenState({ view: 'revealed', effectiveView: 'revealed' })) });
    await clickOne;

    expect(useExtensionStore.getState().hidden?.effectiveView).toBe('only');
    expect(loadSubscriptions).toHaveBeenCalledTimes(1);
    expect(useExtensionStore.getState().pendingHidden).toBe(false);
  });
});

describe('refus qui porte un état', () => {
  it('adopte l’état d’un verrou et n’annonce pas de succès', async () => {
    vi.mocked(api.setHiddenView).mockResolvedValueOnce({
      changed: false,
      state: state(hiddenState({ locked: true, view: 'revealed', effectiveView: 'hidden' })),
    });
    vi.mocked(api.fetchExtensionState).mockResolvedValueOnce(state());
    await useExtensionStore.getState().load();

    await useExtensionStore.getState().cycleHidden();

    expect(useExtensionStore.getState().hidden?.locked).toBe(true);
    // Rien n'a changé : pas de synchronisation inutile.
    expect(loadSubscriptions).not.toHaveBeenCalled();
  });
});

describe('épingles par catégorie', () => {
  it('envoie l’inverse de l’état courant', async () => {
    vi.mocked(api.fetchExtensionState).mockResolvedValueOnce(state());
    await useExtensionStore.getState().load();
    vi.mocked(api.setCategoryFavorite).mockResolvedValueOnce({
      changed: true,
      state: state(hiddenState(), favoritesState({ ids: [2, 1] })),
    });

    await useExtensionStore.getState().toggleCategoryFavorite('user/-/label/Secret');

    expect(api.setCategoryFavorite).toHaveBeenCalledWith(1, true);
    expect(useExtensionStore.getState().favorites?.ids).toEqual([2, 1]);
  });

  it('désépingle une catégorie déjà épinglée', async () => {
    vi.mocked(api.fetchExtensionState).mockResolvedValueOnce(state());
    await useExtensionStore.getState().load();
    vi.mocked(api.setCategoryFavorite).mockResolvedValueOnce({
      changed: true,
      state: state(hiddenState(), favoritesState({ ids: [] })),
    });

    await useExtensionStore.getState().toggleCategoryFavorite('user/-/label/Tech');

    expect(api.setCategoryFavorite).toHaveBeenCalledWith(2, false);
  });

  it('masque une catégorie visible et rétablit une catégorie masquée', async () => {
    vi.mocked(api.fetchExtensionState).mockResolvedValueOnce(state());
    await useExtensionStore.getState().load();
    vi.mocked(api.setCategoryHidden)
      .mockResolvedValueOnce({ changed: true, state: state(hiddenState({ hiddenIds: [1, 2] })) })
      .mockResolvedValueOnce({ changed: true, state: state(hiddenState({ hiddenIds: [] })) });

    await useExtensionStore.getState().toggleCategoryHidden('user/-/label/Tech');
    expect(api.setCategoryHidden).toHaveBeenLastCalledWith(2, true);

    await useExtensionStore.getState().toggleCategoryHidden('user/-/label/Secret');
    expect(api.setCategoryHidden).toHaveBeenLastCalledWith(1, false);
  });
});
