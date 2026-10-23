import type { FavoritesState, FavoritesView, HiddenCategoriesState, HiddenView } from '../api/extensions';

/**
 * Traduction entre ce que la passerelle des extensions connaît (identifiants
 * numériques FreshRSS + noms) et ce que FriRSS manipule (libellés Google
 * Reader `user/-/label/<nom>`).
 *
 * GReader n'expose jamais l'identifiant numérique d'une catégorie : la seule
 * jointure possible est le NOM. Un renommage casse donc le lien jusqu'au
 * prochain `/v1/state` — c'est la limite du modèle, pas un bug.
 *
 * Ces fonctions sont pures et sans état : c'est ici que vit toute la logique de
 * filtrage, pour qu'elle soit testable sans réseau ni React.
 */

const LABEL_BASE = 'user/-/label/';

/** Nom de catégorie FreshRSS → identifiant de libellé GReader. */
export function categoryLabelFromName(name: string): string {
  return LABEL_BASE + name;
}

/** Identifiant de libellé GReader → nom de catégorie FreshRSS. */
export function categoryNameFromLabel(label: string): string {
  const at = label.lastIndexOf('/label/');
  return at === -1 ? label : label.slice(at + '/label/'.length);
}

/**
 * L'œil de Hidden Categories : masqué → entrevu → masqués seuls → masqué.
 *
 * Le cycle est recalculé depuis la valeur que le serveur vient de rendre, jamais
 * depuis un état local optimiste : deux onglets ouverts ne peuvent pas se
 * désynchroniser.
 */
export function nextHiddenView(view: HiddenView | undefined): HiddenView {
  switch (view) {
    case 'revealed':
      return 'only';
    case 'only':
      return 'hidden';
    // Vue inconnue (état pas encore lu) : on démarre le cycle au premier cran
    // plutôt que d'afficher un bouton qui ne ferait rien.
    default:
      return 'revealed';
  }
}

/** L'épingle de Favorite Categories : toutes → épinglées seules → sans → toutes. */
export function nextFavoritesView(view: FavoritesView | undefined): FavoritesView {
  switch (view) {
    case 'only':
      return 'without';
    case 'without':
      return 'all';
    default:
      return 'only';
  }
}

export interface CategoryVisibility {
  /** Au moins une des deux extensions est utilisable. */
  active: boolean;
  hiddenAvailable: boolean;
  favoritesAvailable: boolean;
  /** Frappe en mode Light : c'est le client qui masque, le serveur n'a rien écrit. */
  lightMode: boolean;
  locked: boolean;
  hiddenView: HiddenView;
  favoritesView: FavoritesView;
  /** Libellés masqués côté extension, quelle que soit la vue. */
  allHiddenLabels: Set<string>;
  /** Libellés réellement masqués maintenant (Light, vue « masqué »). */
  hiddenLabels: Set<string>;
  /** Libellés épinglés (Favorite Categories). */
  pinnedLabels: Set<string>;
  onlyHidden: boolean;
  onlyPinned: boolean;
  withoutPinned: boolean;
}

function labelsFromIds(
  state: { categories?: Array<{ id: number; name: string }> } | null,
  ids: number[] | undefined,
): Set<string> {
  const out = new Set<string>();
  if (!state?.categories || !ids?.length) return out;
  const wanted = new Set(ids.map((id) => Number(id)));
  for (const cat of state.categories) {
    if (wanted.has(Number(cat.id)) && cat.name) out.add(categoryLabelFromName(cat.name));
  }
  return out;
}

/**
 * Ce que la barre latérale doit montrer, à partir des deux états serveur.
 *
 * Le verrou prime sur l'œil : quand il est armé, la vue effective est
 * `hidden` quoi que dise la préférence. Le rideau prime sur l'épingle : une
 * catégorie masquée le reste même si elle est épinglée, sinon une épingle
 * contournerait le masquage.
 */
export function categoryVisibility(
  hidden: HiddenCategoriesState | null,
  favorites: FavoritesState | null,
): CategoryVisibility {
  const hiddenAvailable = !!hidden?.available;
  const favoritesAvailable = !!favorites?.available;

  // `effectiveView` est la vue qui s'applique réellement (verrou compris) ;
  // `view` n'est que la préférence stockée.
  const hiddenView = (hidden?.effectiveView || hidden?.view || 'hidden') as HiddenView;
  const favoritesView = (favorites?.view || 'all') as FavoritesView;

  // Light : l'extension filtre dans le navigateur, donc FriRSS doit filtrer
  // aussi. Strict : le serveur a déjà retiré les flux de `subscription/list`,
  // et rejouer le filtre ici masquerait une catégorie que FreshRSS montrerait.
  const lightMode = hiddenAvailable && hidden?.mode !== 'strict';
  const allHiddenLabels = hiddenAvailable ? labelsFromIds(hidden, hidden?.hiddenIds) : new Set<string>();

  return {
    active: hiddenAvailable || favoritesAvailable,
    hiddenAvailable,
    favoritesAvailable,
    lightMode,
    locked: !!hidden?.locked,
    hiddenView,
    favoritesView,
    allHiddenLabels,
    hiddenLabels: lightMode && hiddenView === 'hidden' ? allHiddenLabels : new Set<string>(),
    pinnedLabels: favoritesAvailable ? labelsFromIds(favorites, favorites?.ids) : new Set<string>(),
    onlyHidden: hiddenAvailable && hiddenView === 'only',
    onlyPinned: favoritesAvailable && favoritesView === 'only',
    withoutPinned: favoritesAvailable && favoritesView === 'without',
  };
}

/** Une catégorie de la barre latérale est-elle montrable ? */
export function isCategoryVisible(label: string, vis: CategoryVisibility): boolean {
  // Masquage : en Strict le serveur a déjà retiré les flux de
  // `subscription/list` — rejouer le filtre ici masquerait une catégorie que
  // FreshRSS, lui, montre. Seul le mode Light a besoin du filtre client.
  if (vis.lightMode) {
    // « masqués seuls » : la liste ne contient QUE ce que le rideau cache.
    if (vis.onlyHidden) return vis.allHiddenLabels.has(label);
    if (vis.hiddenView === 'hidden' && vis.allHiddenLabels.has(label)) return false;
  }
  if (vis.onlyPinned) return vis.pinnedLabels.has(label);
  if (vis.withoutPinned) return !vis.pinnedLabels.has(label);
  return true;
}

/**
 * La catégorie est-elle masquée alors qu'elle reste affichée ?
 *
 * C'est ce qui pilote l'étiquette « masquée » de la rangée : en vue « entrevu »
 * les catégories cachées sont mélangées aux autres, et en vue « masqués seuls »
 * elles sont les seules présentes. Dans la vue normale elles ne sont pas là.
 */
export function isCategoryHidden(label: string, vis: CategoryVisibility): boolean {
  if (!vis.hiddenAvailable || !vis.allHiddenLabels.has(label)) return false;
  return vis.hiddenView === 'revealed' || vis.onlyHidden;
}

/** Épinglée côté extension (Favorite Categories), indépendamment de la vue. */
export function isCategoryPinned(label: string, vis: CategoryVisibility): boolean {
  return vis.pinnedLabels.has(label);
}

/**
 * Identifiant numérique d'une catégorie, pour les routes d'écriture.
 *
 * Les deux extensions connaissent la même table `id → nom` ; on prend la
 * première qui répond, Hidden Categories d'abord car c'est elle qui possède le
 * masquage.
 */
export function categoryIdForLabel(
  label: string,
  hidden: HiddenCategoriesState | null,
  favorites: FavoritesState | null,
): number | null {
  const name = categoryNameFromLabel(label);
  for (const state of [hidden, favorites]) {
    if (!state?.available) continue;
    const found = state.categories?.find((cat) => cat.name === name);
    if (found) return Number(found.id);
  }
  return null;
}

export interface CategoryGrouping<T> {
  visible: T[];
  /** Catégories retirées par le filtre — pour un compteur « n masquées ». */
  hiddenCount: number;
}

/**
 * Applique le filtre à une liste de catégories et met les épinglées en tête.
 *
 * L'ordre fourni par l'appelant est conservé à l'intérieur de chaque groupe :
 * l'épinglage déplace, il ne retrie pas.
 */
export function applyCategoryVisibility<T extends { id: string }>(
  categories: readonly T[],
  vis: CategoryVisibility,
): CategoryGrouping<T> {
  if (!vis.active) return { visible: [...categories], hiddenCount: 0 };
  const visible: T[] = [];
  let hiddenCount = 0;
  for (const cat of categories) {
    if (isCategoryVisible(cat.id, vis)) visible.push(cat);
    else hiddenCount += 1;
  }
  if (vis.pinnedLabels.size === 0) return { visible, hiddenCount };
  const pinned = visible.filter((cat) => vis.pinnedLabels.has(cat.id));
  const rest = visible.filter((cat) => !vis.pinnedLabels.has(cat.id));
  return { visible: [...pinned, ...rest], hiddenCount };
}
