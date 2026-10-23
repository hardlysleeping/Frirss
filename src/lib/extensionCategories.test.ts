import { describe, it, expect } from 'vitest';
import type { FavoritesState, HiddenCategoriesState } from '../api/extensions';
import {
  applyCategoryVisibility,
  categoryIdForLabel,
  categoryLabelFromName,
  categoryNameFromLabel,
  categoryVisibility,
  isCategoryHidden,
  isCategoryPinned,
  isCategoryVisible,
  nextFavoritesView,
  nextHiddenView,
} from './extensionCategories';

const label = (name: string) => `user/-/label/${name}`;

const hiddenState = (over: Partial<HiddenCategoriesState> = {}): HiddenCategoriesState => ({
  available: true,
  mode: 'light',
  view: 'hidden',
  effectiveView: 'hidden',
  hiddenIds: [1],
  locked: false,
  hasPasscode: true,
  categories: [
    { id: 1, name: 'Secret', hidden: true },
    { id: 2, name: 'Tech', hidden: false },
    { id: 3, name: 'Comics', hidden: false },
  ],
  ...over,
});

const favoritesState = (over: Partial<FavoritesState> = {}): FavoritesState => ({
  available: true,
  view: 'all',
  ids: [2],
  categories: [
    { id: 1, name: 'Secret', favorite: false },
    { id: 2, name: 'Tech', favorite: true },
    { id: 3, name: 'Comics', favorite: false },
  ],
  ...over,
});

describe('noms et libellés', () => {
  it('fait l’aller-retour entre le nom FreshRSS et le libellé GReader', () => {
    expect(categoryLabelFromName('Tech')).toBe(label('Tech'));
    expect(categoryNameFromLabel(label('Tech'))).toBe('Tech');
  });

  it('garde les noms qui contiennent une espace ou des accents', () => {
    expect(categoryNameFromLabel(label('À lire plus tard'))).toBe('À lire plus tard');
  });

  it('rend le libellé tel quel s’il n’a pas de préfixe', () => {
    expect(categoryNameFromLabel('News')).toBe('News');
  });
});

describe('cycles des boutons', () => {
  it('enchaîne masqué → entrevu → masqués seuls → masqué', () => {
    expect(nextHiddenView('hidden')).toBe('revealed');
    expect(nextHiddenView('revealed')).toBe('only');
    expect(nextHiddenView('only')).toBe('hidden');
  });

  it('part de masqué quand la vue est inconnue', () => {
    expect(nextHiddenView(undefined)).toBe('revealed');
  });

  it('enchaîne toutes → épinglées seules → sans → toutes', () => {
    expect(nextFavoritesView('all')).toBe('only');
    expect(nextFavoritesView('only')).toBe('without');
    expect(nextFavoritesView('without')).toBe('all');
  });

  it('part de toutes quand la vue est inconnue', () => {
    expect(nextFavoritesView(undefined)).toBe('only');
  });
});

describe('visibilité des catégories', () => {
  it('ne fait rien quand aucune extension n’est disponible', () => {
    const vis = categoryVisibility(null, null);
    expect(vis.active).toBe(false);
    expect(isCategoryVisible(label('Secret'), vis)).toBe(true);
    expect(isCategoryPinned(label('Tech'), vis)).toBe(false);
  });

  it('masque en Light, laisse tout passer en Strict', () => {
    const light = categoryVisibility(hiddenState(), favoritesState({ ids: [] }));
    expect(isCategoryVisible(label('Secret'), light)).toBe(false);
    expect(isCategoryVisible(label('Tech'), light)).toBe(true);

    // En Strict, le serveur a déjà retiré les flux : filtrer ici masquerait une
    // catégorie que FreshRSS, lui, montre.
    const strict = categoryVisibility(hiddenState({ mode: 'strict' }), favoritesState({ ids: [] }));
    expect(isCategoryVisible(label('Secret'), strict)).toBe(true);
  });

  it('en vue « entrevu » montre tout et étiquette les masquées', () => {
    const vis = categoryVisibility(
      hiddenState({ view: 'revealed', effectiveView: 'revealed' }),
      favoritesState({ ids: [] }),
    );
    expect(isCategoryVisible(label('Secret'), vis)).toBe(true);
    expect(isCategoryHidden(label('Secret'), vis)).toBe(true);
    expect(isCategoryHidden(label('Tech'), vis)).toBe(false);
  });

  it('en vue « masqués seuls » ne garde que les masquées', () => {
    const vis = categoryVisibility(
      hiddenState({ view: 'only', effectiveView: 'only' }),
      favoritesState({ ids: [] }),
    );
    expect(isCategoryVisible(label('Secret'), vis)).toBe(true);
    expect(isCategoryVisible(label('Tech'), vis)).toBe(false);
    expect(isCategoryHidden(label('Secret'), vis)).toBe(true);
  });

  it('le verrou prime sur l’œil : la vue effective est masquée', () => {
    const vis = categoryVisibility(
      hiddenState({ view: 'revealed', effectiveView: 'hidden', locked: true }),
      favoritesState({ ids: [] }),
    );
    expect(vis.locked).toBe(true);
    expect(vis.hiddenView).toBe('hidden');
    expect(isCategoryVisible(label('Secret'), vis)).toBe(false);
  });

  it('le rideau prime sur l’épingle', () => {
    // Secret est masquée ET épinglée : la vue « épinglées seules » ne doit pas
    // la faire réapparaître.
    const vis = categoryVisibility(
      hiddenState(),
      favoritesState({ view: 'only', ids: [1, 2] }),
    );
    expect(isCategoryVisible(label('Secret'), vis)).toBe(false);
    expect(isCategoryVisible(label('Tech'), vis)).toBe(true);
  });

  it('« sans les épinglées » retire les épinglées', () => {
    const vis = categoryVisibility(hiddenState({ hiddenIds: [] }), favoritesState({ view: 'without' }));
    expect(isCategoryVisible(label('Tech'), vis)).toBe(false);
    expect(isCategoryVisible(label('Comics'), vis)).toBe(true);
  });

  it('« épinglées seules » ne garde que les épinglées', () => {
    const vis = categoryVisibility(hiddenState({ hiddenIds: [] }), favoritesState({ view: 'only' }));
    expect(isCategoryVisible(label('Tech'), vis)).toBe(true);
    expect(isCategoryVisible(label('Comics'), vis)).toBe(false);
  });
});

describe('application du filtre à la liste', () => {
  const cats = [
    { id: label('Comics'), label: 'Comics', feeds: [] },
    { id: label('Tech'), label: 'Tech', feeds: [] },
    { id: label('Secret'), label: 'Secret', feeds: [] },
  ];

  it('conserve l’ordre fourni et compte les masquées', () => {
    const vis = categoryVisibility(hiddenState(), favoritesState({ ids: [] }));
    const { visible, hiddenCount } = applyCategoryVisibility(cats, vis);
    expect(visible.map((c) => c.label)).toEqual(['Comics', 'Tech']);
    expect(hiddenCount).toBe(1);
  });

  it('remonte les épinglées en tête sans retrie r le reste', () => {
    // id 3 = Comics, épinglée : elle passe devant, les autres gardent leur ordre.
    const vis = categoryVisibility(hiddenState({ hiddenIds: [] }), favoritesState({ ids: [3] }));
    const { visible } = applyCategoryVisibility(cats, vis);
    expect(visible.map((c) => c.label)).toEqual(['Comics', 'Tech', 'Secret']);
  });

  it('ne touche à rien quand aucune extension n’est utilisable', () => {
    const vis = categoryVisibility(null, null);
    expect(applyCategoryVisibility(cats, vis)).toEqual({ visible: cats, hiddenCount: 0 });
  });
});

describe('identifiant numérique d’une catégorie', () => {
  it('le trouve par son nom', () => {
    expect(categoryIdForLabel(label('Comics'), hiddenState(), favoritesState())).toBe(3);
  });

  it('retombe sur l’autre extension quand la première ne la connaît pas', () => {
    const partial = hiddenState({ categories: [{ id: 1, name: 'Secret', hidden: true }] });
    expect(categoryIdForLabel(label('Tech'), partial, favoritesState())).toBe(2);
  });

  it('rend null quand aucune extension ne connaît le nom', () => {
    expect(categoryIdForLabel(label('Inconnue'), hiddenState(), favoritesState())).toBeNull();
  });
});
