// Zen mode hides the global app chrome (Sidebar, UtilityBar, ribbon). Module-level $state
// singleton (layout and IdeShell share it without prop threading).
export const zenState = $state({ on: false });

export function toggleZen() {
	zenState.on = !zenState.on;
}
