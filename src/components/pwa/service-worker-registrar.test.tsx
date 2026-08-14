import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceWorkerRegistrar } from "./service-worker-registrar";

type Listener = (event: Event) => void;

function createEmitter() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    addEventListener: vi.fn((type: string, handler: Listener) => {
      const set = listeners.get(type) ?? new Set<Listener>();
      set.add(handler);
      listeners.set(type, set);
    }),
    removeEventListener: vi.fn((type: string, handler: Listener) => {
      listeners.get(type)?.delete(handler);
    }),
    emit(type: string) {
      for (const handler of [...(listeners.get(type) ?? [])]) {
        handler(new Event(type));
      }
    },
  };
}

type StubOptions = { waiting?: boolean; controller?: boolean };

/** Enough of a ServiceWorker for the registrar; the slots are reassignable so a
 *  test can drive the install lifecycle the way the browser does. */
type FakeWorker = {
  state: string;
  postMessage: ReturnType<typeof vi.fn>;
  addEventListener?: ReturnType<typeof vi.fn>;
  removeEventListener?: ReturnType<typeof vi.fn>;
};

function stubServiceWorker({
  waiting = false,
  controller = false,
}: StubOptions = {}) {
  const waitingWorker: FakeWorker | null = waiting
    ? { postMessage: vi.fn(), state: "installed" }
    : null;
  const registrationEvents = createEmitter();
  const registration = {
    active: null as FakeWorker | null,
    installing: null as FakeWorker | null,
    waiting: waitingWorker as FakeWorker | null,
    scope: "/",
    update: vi.fn(async () => undefined),
    unregister: vi.fn(async () => true),
    addEventListener: registrationEvents.addEventListener,
    removeEventListener: registrationEvents.removeEventListener,
  };
  const containerEvents = createEmitter();
  const container = {
    controller: controller ? { postMessage: vi.fn() } : null,
    register: vi.fn(async () => registration),
    getRegistration: vi.fn(async () => registration),
    getRegistrations: vi.fn(async () => [registration]),
    ready: Promise.resolve(registration),
    addEventListener: containerEvents.addEventListener,
    removeEventListener: containerEvents.removeEventListener,
  };

  Object.defineProperty(window.navigator, "serviceWorker", {
    configurable: true,
    value: container,
  });

  return {
    container,
    registration,
    waitingWorker,
    emitControllerChange: () => containerEvents.emit("controllerchange"),
    emitUpdateFound: () => registrationEvents.emit("updatefound"),
  };
}

const originalLocation = window.location;
let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...originalLocation, reload },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    value: originalLocation,
  });
  Reflect.deleteProperty(window.navigator, "serviceWorker");
  vi.restoreAllMocks();
});

describe("GH-13 service worker registration (AC8)", () => {
  it("SR-001 registers nothing while disabled", async () => {
    const { container: worker } = stubServiceWorker();

    const { container } = render(<ServiceWorkerRegistrar enabled={false} />);
    await waitFor(() => expect(container).toBeEmptyDOMElement());

    expect(worker.register).not.toHaveBeenCalled();
    expect(screen.queryByTestId("sw-update-prompt")).not.toBeInTheDocument();
  });

  it("SR-002 registers /sw.js at the root scope with no HTTP caching", async () => {
    const { container: worker } = stubServiceWorker();

    const { container } = render(<ServiceWorkerRegistrar enabled />);

    await waitFor(() =>
      expect(worker.register).toHaveBeenCalledWith("/sw.js", {
        scope: "/",
        updateViaCache: "none",
      }),
    );
    expect(worker.register).toHaveBeenCalledTimes(1);
    // No prompt on a first install, but the live region is mounted and empty so
    // a later update can actually be announced.
    expect(screen.queryByTestId("sw-update-prompt")).not.toBeInTheDocument();
    expect(screen.getByRole("status")).toBeEmptyDOMElement();
    expect(container.textContent).toBe("");
  });

  it("SR-002b prompts when a worker installs while the page is already controlled", async () => {
    // No parked worker: the update has to arrive through updatefound, which is
    // what actually happens when a deploy lands while the app is open.
    const { registration, emitUpdateFound } = stubServiceWorker({
      controller: true,
    });

    render(<ServiceWorkerRegistrar enabled />);
    await waitFor(() =>
      expect(registration.addEventListener).toHaveBeenCalledWith(
        "updatefound",
        expect.any(Function),
      ),
    );
    expect(screen.queryByTestId("sw-update-prompt")).not.toBeInTheDocument();

    // The real in-session deploy path: a worker starts installing after the
    // page loaded, and only becomes promotable once it reaches "installed".
    const installing: FakeWorker = {
      state: "installing",
      postMessage: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    registration.installing = installing;
    emitUpdateFound();

    const statechange = installing.addEventListener?.mock.calls.find(
      (call) => call[0] === "statechange",
    )?.[1] as (() => void) | undefined;
    expect(statechange).toBeTypeOf("function");

    // Still only "installing": nothing to announce yet.
    statechange?.();
    expect(screen.queryByTestId("sw-update-prompt")).not.toBeInTheDocument();

    installing.state = "installed";
    registration.waiting = installing;
    statechange?.();

    expect(await screen.findByTestId("sw-update-prompt")).toBeInTheDocument();
  });

  it("SR-003 does not throw where service workers are unsupported", async () => {
    Reflect.deleteProperty(window.navigator, "serviceWorker");

    expect(() => render(<ServiceWorkerRegistrar enabled />)).not.toThrow();

    // The empty live region still renders: the markup must not depend on a
    // browser-only global, or the server and the client disagree on hydration.
    // What must not happen is a prompt or a crash.
    await waitFor(() =>
      expect(screen.getByRole("status")).toBeEmptyDOMElement(),
    );
    expect(screen.queryByTestId("sw-update-prompt")).not.toBeInTheDocument();
  });
});

describe("GH-13 update prompt (AC5, AC8)", () => {
  it("SR-004 surfaces an accessible prompt when a worker waits behind a controller", async () => {
    stubServiceWorker({ waiting: true, controller: true });

    render(<ServiceWorkerRegistrar enabled />);

    const prompt = await screen.findByTestId("sw-update-prompt");
    // Non-colour status: the prompt says what changed in words.
    expect(prompt).toHaveTextContent(/new version|update available|update/i);
    expect(
      screen.getByRole("button", { name: /refresh now/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /later/i })).toBeInTheDocument();
  });

  it("SR-005 asks only the waiting worker to skip waiting", async () => {
    const { waitingWorker } = stubServiceWorker({
      waiting: true,
      controller: true,
    });

    render(<ServiceWorkerRegistrar enabled />);
    await screen.findByTestId("sw-update-prompt");
    fireEvent.click(screen.getByRole("button", { name: /refresh now/i }));

    expect(waitingWorker?.postMessage).toHaveBeenCalledWith({
      type: "SKIP_WAITING",
    });
    expect(waitingWorker?.postMessage).toHaveBeenCalledTimes(1);
    expect(reload).not.toHaveBeenCalled();
  });

  it("SR-006 dismisses the prompt without posting when the member picks Later", async () => {
    const { waitingWorker } = stubServiceWorker({
      waiting: true,
      controller: true,
    });

    render(<ServiceWorkerRegistrar enabled />);
    await screen.findByTestId("sw-update-prompt");
    fireEvent.click(screen.getByRole("button", { name: /later/i }));

    await waitFor(() =>
      expect(screen.queryByTestId("sw-update-prompt")).not.toBeInTheDocument(),
    );
    expect(waitingWorker?.postMessage).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it("SR-007 shows no prompt on a first-ever install, where no controller exists", async () => {
    const { container: worker } = stubServiceWorker({
      waiting: true,
      controller: false,
    });

    render(<ServiceWorkerRegistrar enabled />);
    await waitFor(() => expect(worker.register).toHaveBeenCalled());

    expect(screen.queryByTestId("sw-update-prompt")).not.toBeInTheDocument();
    expect(reload).not.toHaveBeenCalled();
  });
});

describe("GH-13 controllerchange cannot loop (AC8)", () => {
  it("SR-008 reloads once, and only after the member asked to refresh", async () => {
    const { emitControllerChange } = stubServiceWorker({
      waiting: true,
      controller: true,
    });

    render(<ServiceWorkerRegistrar enabled />);
    await screen.findByTestId("sw-update-prompt");

    fireEvent.click(screen.getByRole("button", { name: /refresh now/i }));

    emitControllerChange();
    emitControllerChange();
    emitControllerChange();

    await waitFor(() => expect(reload).toHaveBeenCalledTimes(1));
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("SR-009 never reloads for a first-ever install's controllerchange", async () => {
    const { container: worker, emitControllerChange } = stubServiceWorker({
      waiting: false,
      controller: false,
    });

    render(<ServiceWorkerRegistrar enabled />);
    await waitFor(() => expect(worker.register).toHaveBeenCalled());

    emitControllerChange();
    emitControllerChange();

    expect(reload).not.toHaveBeenCalled();
  });

  it("SR-010 never reloads when the prompt was dismissed instead of accepted", async () => {
    const { emitControllerChange } = stubServiceWorker({
      waiting: true,
      controller: true,
    });

    render(<ServiceWorkerRegistrar enabled />);
    await screen.findByTestId("sw-update-prompt");
    fireEvent.click(screen.getByRole("button", { name: /later/i }));

    emitControllerChange();

    expect(reload).not.toHaveBeenCalled();
  });
});
