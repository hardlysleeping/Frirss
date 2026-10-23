import client from './client';

/**
 * Passerelle vers les extensions FreshRSS (Hidden Categories, Favorite
 * Categories).
 *
 * FriRSS n'écrit jamais `priority` et ne réimplémente ni le cycle de l'œil ni
 * celui de l'épingle : l'extension `xExtension-HardlyRead` installée côté
 * FreshRSS expose un petit JSON qui authentifie l'appel avec le MÊME
 * identifiant que l'API Google Reader et délègue à l'extension propriétaire de
 * l'état. Le proxy de FriRSS injecte déjà cet en-tête `GoogleLogin` pour toute
 * cible située sous l'URL du serveur configuré (`server/routes/proxy.ts`), donc
 * ces requêtes passent par le client habituel, sans nouvelle route serveur.
 *
 * Ce qui compte pour la synchronisation : la requête d'écriture ne rend la main
 * qu'une fois le balayage Strict terminé côté PHP. « Attendre la fin » veut donc
 * dire attendre la réponse HTTP — pas de sondage, pas de délai fixe.
 */

/** Base de la passerelle, sous la racine du serveur FreshRSS configuré. */
export const EXTENSION_API = '/api/misc.php/Hardly%20Read/v1';

export type HiddenView = 'hidden' | 'revealed' | 'only';
export type FavoritesView = 'all' | 'only' | 'without';

export interface ExtensionCategory {
  id: number;
  name: string;
}

export interface HiddenCategoriesState {
  available: boolean;
  /** Light : l'extension filtre dans le navigateur. Strict : les flux sont écrits. */
  mode?: 'light' | 'strict';
  view?: HiddenView;
  /** Ce que l'utilisateur voit réellement — le verrou prime sur l'œil. */
  effectiveView?: HiddenView;
  hiddenIds?: number[];
  locked?: boolean;
  hasPasscode?: boolean;
  categories?: Array<ExtensionCategory & { hidden: boolean }>;
}

export interface FavoritesState {
  available: boolean;
  view?: FavoritesView;
  ids?: number[];
  categories?: Array<ExtensionCategory & { favorite: boolean }>;
}

export interface ExtensionState {
  hiddenCategories: HiddenCategoriesState;
  favorites: FavoritesState;
}

/** État neutre : extension absente ou désactivée pour cet utilisateur. */
const UNAVAILABLE_HIDDEN: HiddenCategoriesState = { available: false };
const UNAVAILABLE_FAVORITES: FavoritesState = { available: false };

function asHiddenState(value: unknown): HiddenCategoriesState {
  if (!value || typeof value !== 'object') return UNAVAILABLE_HIDDEN;
  const state = value as HiddenCategoriesState;
  return state.available ? state : UNAVAILABLE_HIDDEN;
}

function asFavoritesState(value: unknown): FavoritesState {
  if (!value || typeof value !== 'object') return UNAVAILABLE_FAVORITES;
  const state = value as FavoritesState;
  return state.available ? state : UNAVAILABLE_FAVORITES;
}

/**
 * L'état des deux extensions, en une requête.
 *
 * Une extension désactivée revient en `available: false` et ne casse rien : le
 * client la traite comme absente, jamais comme une erreur.
 */
export async function fetchExtensionState(): Promise<ExtensionState> {
  const { data } = await client.get(EXTENSION_API + '/state');
  return {
    hiddenCategories: asHiddenState(data?.hiddenCategories),
    favorites: asFavoritesState(data?.favorites),
  };
}

/**
 * Extrait l'état d'une réponse d'erreur.
 *
 * `423 locked` et `409 convergence_failed` renvoient l'état autoritaire : le
 * client se recale dessus au lieu d'annuler sa dernière action, car l'écriture a
 * bien eu lieu (ou le verrou explique le refus).
 */
function stateFromError(error: unknown): ExtensionMutation['state'] {
  const data = (error as { response?: { data?: Record<string, unknown> } })?.response?.data;
  if (!data) return null;
  const hidden = data.hiddenCategories;
  const favorites = data.favorites;
  if (!hidden && !favorites) return null;
  const state: NonNullable<ExtensionMutation['state']> = {};
  if (hidden) state.hiddenCategories = asHiddenState(hidden);
  if (favorites) state.favorites = asFavoritesState(favorites);
  return state;
}

/** Code d'erreur documenté de la passerelle (`locked`, `convergence_failed`, …). */
export function extensionErrorCode(error: unknown): string {
  const data = (error as { response?: { data?: { error?: { code?: string } } } })?.response?.data;
  return data?.error?.code || '';
}

export interface ExtensionMutation {
  /** `false` quand l'état n'a pas bougé (cliquer deux fois sur le même cran). */
  changed: boolean;
  /**
   * État après coup — toujours la vérité serveur, jamais une supposition.
   *
   * PARTIEL à dessein : la passerelle ne renvoie que l'extension concernée par
   * l'écriture (`hiddenCategories` pour l'œil, `favorites` pour l'épingle).
   * Lire l'absence de l'autre clé comme « extension disparue » faisait
   * s'évanouir les boutons de l'épingle après un simple clic sur l'œil.
   */
  state: {
    hiddenCategories?: HiddenCategoriesState;
    favorites?: FavoritesState;
  } | null;
}

/**
 * Résultat commun des écritures.
 *
 * Une erreur qui porte un état le rend à l'appelant au lieu de le propager :
 * c'est ainsi qu'un refus (verrou) devient un affichage correct plutôt qu'un
 * rollback. Les autres erreurs remontent, pour que l'appelant les annonce.
 */
async function mutate(request: () => Promise<{ data?: Record<string, unknown> }>): Promise<ExtensionMutation> {
  try {
    const { data } = await request();
    const hidden = data?.hiddenCategories;
    const favorites = data?.favorites;
    const state: NonNullable<ExtensionMutation['state']> = {};
    if (hidden) state.hiddenCategories = asHiddenState(hidden);
    if (favorites) state.favorites = asFavoritesState(favorites);
    return {
      changed: data?.changed !== false,
      state: hidden || favorites ? state : null,
    };
  } catch (error) {
    const state = stateFromError(error);
    if (!state) throw error;
    return { changed: false, state };
  }
}

export function setHiddenView(view: HiddenView): Promise<ExtensionMutation> {
  return mutate(() => client.put(EXTENSION_API + '/hidden-categories/view', { view }));
}

export function setCategoryHidden(id: number, hidden: boolean): Promise<ExtensionMutation> {
  return mutate(() => client.put(`${EXTENSION_API}/hidden-categories/${id}`, { hidden }));
}

export function setFavoritesView(view: FavoritesView): Promise<ExtensionMutation> {
  return mutate(() => client.put(EXTENSION_API + '/favorites/view', { view }));
}

export function setCategoryFavorite(id: number, favorite: boolean): Promise<ExtensionMutation> {
  return mutate(() => client.put(`${EXTENSION_API}/favorites/${id}`, { favorite }));
}
