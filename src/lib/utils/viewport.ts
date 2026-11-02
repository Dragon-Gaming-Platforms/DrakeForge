const MOBILE_QUERY = '(max-width: 768px)';

/**
 * Calls `onChange` with the current viewport class, then again on every crossing of the mobile
 * breakpoint; returns a disposer. Callers hold their own state, so a reaction to a crossing
 * (collapsing a side panel, say) fires only on the crossing itself.
 */
export function watchIsMobile(onChange: (isMobile: boolean) => void): () => void {
	const query = window.matchMedia(MOBILE_QUERY);
	const handleChange = () => onChange(query.matches);

	handleChange();
	query.addEventListener('change', handleChange);
	return () => query.removeEventListener('change', handleChange);
}
