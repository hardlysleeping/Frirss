import type { HiddenView } from '../../api/extensions';

/**
 * Les trois pictogrammes de l'intégration des extensions.
 *
 * Ils sont tracés comme le reste de la barre latérale (trait 1.5, 24×24,
 * `currentColor`) pour que les nouveaux boutons ne se distinguent pas des
 * anciens. L'état est porté par la forme, jamais par la couleur seule : l'œil
 * barré veut dire « masquées », l'épingle pleine veut dire « épinglée ».
 */

export function EyeIcon({ view, className = 'w-3.5 h-3.5' }: { view: HiddenView; className?: string }) {
  if (view === 'hidden') {
    // Œil barré : les catégories sont masquées.
    return (
      <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.98 8.223A10.477 10.477 0 001.934 12C3.226 16.338 7.244 19.5 12 19.5c.993 0 1.953-.138 2.863-.395M6.228 6.228A10.451 10.451 0 0112 4.5c4.756 0 8.773 3.162 10.065 7.498a10.523 10.523 0 01-4.293 5.774M6.228 6.228L3 3m3.228 3.228l3.65 3.65m7.894 7.894L21 21m-3.228-3.228l-3.65-3.65m0 0a3 3 0 10-4.243-4.243m4.242 4.242L9.88 9.88" />
      </svg>
    );
  }
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M2.036 12.322a1.012 1.012 0 010-.639C3.423 7.51 7.36 4.5 12 4.5c4.638 0 8.573 3.007 9.963 7.178.07.207.07.431 0 .639C20.577 16.49 16.64 19.5 12 19.5c-4.638 0-8.573-3.007-9.963-7.178z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      {/* Le point plein distingue « entrevu » de « masqués seuls ». */}
      {view === 'only' && <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />}
    </svg>
  );
}

export function PinIcon({ filled, className = 'w-3.5 h-3.5' }: { filled: boolean; className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth={1.5}
    >
      <path
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M15.75 3.75l4.5 4.5-1.5 1.5a3 3 0 00-.879 2.121v2.379a1.5 1.5 0 01-.44 1.06l-1.311 1.311a1.5 1.5 0 01-2.121 0l-4.5-4.5a1.5 1.5 0 010-2.121l1.311-1.311a1.5 1.5 0 011.06-.439h2.379a3 3 0 002.121-.879l1.38-1.38zM9.75 14.25L4.5 19.5"
      />
    </svg>
  );
}

export function LockIcon({ className = 'w-3.5 h-3.5' }: { className?: string }) {
  return (
    <svg className={className} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
    </svg>
  );
}
