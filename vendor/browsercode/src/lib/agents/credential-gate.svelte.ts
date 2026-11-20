import type { CredentialSpec } from '$lib/config/tools';
import { describeError } from './boot';

/** `idle` renders no overlay; every other stage covers the terminal. */
export type GateStage = 'idle' | 'loading' | 'signin' | 'error';

export type CredentialGateOptions = {
	/** A newly saved secret only reaches the CLI through a fresh launch. */
	onRestart: () => void;
};

/**
 * Drives the boot overlay for a CLI that declares a `CredentialSpec`. It surfaces a failed boot
 * itself because the terminal `bootCLI` wrote that failure into sits behind this overlay.
 */
export class CredentialGate {
	stage = $state<GateStage>('idle');
	error = $state('');
	/** Assumed until `begin()` reads storage, so the loading card does not flash a false prompt. */
	hasCredential = $state(true);
	/** Not a stage: the toolbar can open this over an idle gate, after a boot has finished. */
	changeOpen = $state(false);

	private resolveSignIn: ((value: string) => void) | null = null;
	private rejectSignIn: ((error: Error) => void) | null = null;

	constructor(
		private credential: CredentialSpec,
		private options: CredentialGateOptions
	) {}

	get overlayVisible(): boolean {
		return this.stage !== 'idle' || this.changeOpen;
	}

	/** Call before `bootCLI`, so the overlay is up before the image starts streaming. */
	begin = (): void => {
		this.hasCredential = this.credential.get() !== null;
		this.stage = 'loading';
	};

	/**
	 * Blocks the launch until a secret is stored, rather than overlaying a CLI already running
	 * without one, which could not be handed it afterwards. Rejects if the overlay is cancelled
	 * so bootCLI fails visibly instead of hanging under a spinner forever.
	 */
	beforeLaunch = async (): Promise<void> => {
		if (!this.credential.get()) {
			this.stage = 'signin';
			try {
				this.credential.set(
					await new Promise<string>((resolve, reject) => {
						this.resolveSignIn = resolve;
						this.rejectSignIn = reject;
					})
				);
			} finally {
				this.resolveSignIn = null;
				this.rejectSignIn = null;
			}
			this.hasCredential = true;
		}
		this.stage = 'idle';
	};

	submit = (value: string): void => {
		this.resolveSignIn?.(value);
	};

	/** Abandon a pending sign-in so `beforeLaunch` settles (boot fails with this error). */
	cancelSignIn = (message = 'Sign-in cancelled before the CLI could start.'): void => {
		this.rejectSignIn?.(new Error(message));
		this.rejectSignIn = null;
		this.resolveSignIn = null;
		this.stage = 'idle';
	};

	saveAndRestart = (value: string): void => {
		this.credential.set(value);
		this.options.onRestart();
	};

	reportBootFailure = (error: unknown): void => {
		this.error = describeError(error);
		this.stage = 'error';
	};

	openChange = (): void => {
		this.changeOpen = true;
	};

	closeChange = (): void => {
		this.changeOpen = false;
	};
}
