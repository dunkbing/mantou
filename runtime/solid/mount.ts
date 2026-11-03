// Renders a component tree into a Ui: a root view that fills the window.
import type { JSX } from "../jsx-runtime";
import type { Ui } from "../ui";
import { UiContext, createComponent, render } from "./renderer";

/** Renders `app` into `ui` and returns a function that disposes it. */
export function mount(ui: Ui, app: () => JSX.Element): () => void {
  const root = ui.view();
  ui.setRoot(root);
  const Provider = UiContext.Provider as unknown as (props: { value: Ui; children: JSX.Element }) => JSX.Element;
  const dispose = render(
    () =>
      createComponent(Provider as never, {
        value: ui,
        get children() {
          return app();
        },
      }) as never,
    root,
  );
  return () => {
    dispose();
    ui.setRoot(null);
    root.release();
  };
}
