import { create } from 'zustand';
import {
  extensionErrorCode,
  fetchExtensionState,
  setCategoryFavorite,
  setCategoryHidden,
  setFavoritesView,
  setHiddenView,
  type ExtensionMutation,
  type ExtensionState,
  type FavoritesState,
  type HiddenCategoriesState,
} from '../api/extensions';
import {
  categoryIdForLabel,
  categoryVisibility,
  nextFavoritesView,
  nextHiddenView,
  type CategoryVisibility,
} from '../lib/extensionCategories';
import { useFeedStore } from './feedStore';
import { useUiStore } from './uiStore';

/**
 * Les deux extensions de catégories, vues depuis FriRSS.
 *
 * Rien n'est écrit en local et rien n'est deviné : chaque clic envoie l'intention
 * à la passerelle PHP, qui délègue à l'extension propriétaire de l'état, puis le
 * magasin adopte l'état RENVOYÉ. C'est ce qui rend « Strict » correct sans que
 * FriRSS touche lui-même à `priority` : le balayage est fait côté serveur, et la
 * réponse HTTP n'arrive qu'une fois ce balayage terminé.
 *
 * Le rafraîchissement qui suit n'est pas `refresh()` (qui déclenche une collecte
 * de flux côté serveur, inutile ici) : on relit les abonnements et la vue
 * courante, c'est tout.
 */

/**
 * Numéro de la dernière action lancée.
 *
 * Deux clics rapides produisent deux requêtes qui peuvent revenir dans le
 * désordre. Seule la PLUS RÉCENTE a le droit d'écrire l'état et de lancer la
 * synchronisation : sinon la réponse lente écraserait la rapide et la barre
 * latérale afficherait un cran que l'utilisateur a déjà dépassé.
 */
let actionSeq = 0;

export interface ExtensionStore {
  hidden: HiddenCategoriesState | null;
  favorites: FavoritesState | null;
  /** Une lecture d'état est en vol (au démarrage, ou après reconnexion). */
  loading: boolean;
  /** Écriture en vol pour chaque extension — c'est ce qui désactive le bouton. */
  pendingHidden: boolean;
  pendingFavorites: boolean;

  /** Lecture initiale : à appeler quand la session FreshRSS est établie. */
  load: () => Promise<void>;
  /** Efface l'état à la déconnexion ou au changement de serveur. */
  reset: () => void;

  cycleHidden: () => Promise<void>;
  cycleFavorites: () => Promise<void>;
  toggleCategoryHidden: (label: string) => Promise<void>;
  toggleCategoryFavorite: (label: string) => Promise<void>;
}

/**
 * Après une écriture acceptée : relire la vérité du serveur.
 *
 * L'ordre compte. En Strict, `loadSubscriptions()` est ce qui fait apparaître ou
 * disparaître les flux ; `silentRefresh()` remet ensuite la liste et les
 * compteurs de la vue courante d'aplomb. L'inverse laisserait un instant une
 * liste d'articles appartenant à une catégorie déjà masquée.
 */
async function syncAfterCategoryChange(): Promise<void> {
  const feed = useFeedStore.getState();
  await feed.loadSubscriptions();
  await feed.silentRefresh();
}

function notify(key: string): void {
  // Le texte est résolu par i18next au moment de l'affichage ; le magasin ne
  // dépend pas du hook de traduction. Un bandeau d'erreur, jamais un
  // « c'est fait » : un changement réussi se voit déjà dans la barre latérale.
  import('../i18n').then(({ default: i18n }) => {
    useUiStore.getState().pushToast(i18n.t(key), { tone: 'error' });
  }).catch(() => { /* un bandeau manquant ne doit pas casser une écriture */ });
}

/** Un refus de la passerelle qui n'a pas d'état à adopter. */
function failureKey(code: string): string {
  switch (code) {
    case 'locked':
      return 'extension.locked';
    case 'convergence_failed':
      return 'extension.convergenceFailed';
    default:
      return 'extension.failed';
  }
}

export const useExtensionStore = create<ExtensionStore>((set, get) => {
  /**
   * Adopte un état serveur, s'il y en a un — clé par clé.
   *
   * Une réponse d'écriture ne porte que l'extension qu'elle a modifiée :
   * n'écrire que les clés présentes évite qu'un clic sur l'œil efface l'état
   * de l'épingle (et donc ses boutons) faute de le retrouver dans la réponse.
   */
  const adopt = (state: ExtensionMutation['state']) => {
    if (!state) return;
    const patch: Partial<ExtensionStore> = {};
    if (state.hiddenCategories) {
      patch.hidden = state.hiddenCategories.available ? state.hiddenCategories : null;
    }
    if (state.favorites) {
      patch.favorites = state.favorites.available ? state.favorites : null;
    }
    if (Object.keys(patch).length) set(patch);
  };

  /**
   * Le corps commun des quatre écritures.
   *
   * `request` renvoie l'état autoritaire (y compris pour un refus qui en porte
   * un, comme un verrou) ; `isMine` dit si cette réponse est encore la plus
   * récente. Une réponse périmée ne touche à rien — pas même l'indicateur
   * d'attente, qui appartient à la requête suivante.
   */
  const run = async (
    which: 'hidden' | 'favorites',
    isMine: () => boolean,
    request: () => Promise<ExtensionMutation>,
  ) => {
    const flag = which === 'hidden' ? 'pendingHidden' : 'pendingFavorites';
    set({ [flag]: true } as Partial<ExtensionStore>);
    try {
      const result = await request();
      if (!isMine()) return;
      adopt(result.state);
      if (result.changed) await syncAfterCategoryChange();
      if (!isMine()) return;
      if (which === 'hidden' && result.state?.hiddenCategories?.locked) notify('extension.locked');
    } catch (error) {
      if (isMine()) notify(failureKey(extensionErrorCode(error)));
    } finally {
      if (isMine()) set({ [flag]: false } as Partial<ExtensionStore>);
    }
  };

  return {
    hidden: null,
    favorites: null,
    loading: false,
    pendingHidden: false,
    pendingFavorites: false,

    load: async () => {
      set({ loading: true });
      const mine = ++actionSeq;
      try {
        const state = await fetchExtensionState();
        if (mine !== actionSeq) return;
        set({
          hidden: state.hiddenCategories.available ? state.hiddenCategories : null,
          favorites: state.favorites.available ? state.favorites : null,
        });
      } catch {
        // Passerelle absente (extension non installée, serveur ancien) : on se
        // tait et les boutons n'apparaissent pas. Ce n'est pas une panne de
        // FriRSS, c'est une fonctionnalité du serveur qui n'est pas là.
        if (mine === actionSeq) set({ hidden: null, favorites: null });
      } finally {
        if (mine === actionSeq) set({ loading: false });
      }
    },

    reset: () => {
      actionSeq += 1;
      set({ hidden: null, favorites: null, loading: false, pendingHidden: false, pendingFavorites: false });
    },

    cycleHidden: async () => {
      const current = get().hidden;
      if (!current?.available || current.locked) return;
      const view = nextHiddenView(current.effectiveView || current.view);
      const mine = ++actionSeq;
      await run('hidden', () => mine === actionSeq, () => setHiddenView(view));
    },

    cycleFavorites: async () => {
      if (!get().favorites?.available) return;
      const view = nextFavoritesView(get().favorites?.view);
      const mine = ++actionSeq;
      await run('favorites', () => mine === actionSeq, () => setFavoritesView(view));
    },

    toggleCategoryHidden: async (label: string) => {
      const { hidden, favorites } = get();
      if (!hidden?.available || hidden.locked) return;
      const id = categoryIdForLabel(label, hidden, favorites);
      if (id === null) return;
      const isHidden = (hidden.hiddenIds || []).some((value) => Number(value) === id);
      const mine = ++actionSeq;
      await run('hidden', () => mine === actionSeq, () => setCategoryHidden(id, !isHidden));
    },

    toggleCategoryFavorite: async (label: string) => {
      const { hidden, favorites } = get();
      if (!favorites?.available) return;
      const id = categoryIdForLabel(label, hidden, favorites);
      if (id === null) return;
      const isFavorite = (favorites.ids || []).some((value) => Number(value) === id);
      const mine = ++actionSeq;
      await run('favorites', () => mine === actionSeq, () => setCategoryFavorite(id, !isFavorite));
    },
  };
});

/**
 * La vue calculée des deux états, hors React.
 *
 * Les composants l'enveloppent dans un `useMemo` ; les tests l'appellent
 * directement avec deux états, sans monter l'application.
 */
export function categoryVisibilityOf(
  hidden: HiddenCategoriesState | null,
  favorites: FavoritesState | null,
): CategoryVisibility {
  return categoryVisibility(hidden, favorites);
}
