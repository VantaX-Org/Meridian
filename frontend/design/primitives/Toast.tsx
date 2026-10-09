"use client";

import { Toast as BaseToast } from "@base-ui/react/toast";

export const toastManager = BaseToast.createToastManager();

export function ToastViewport() {
  return (
    <BaseToast.Provider toastManager={toastManager}>
      <BaseToast.Portal>
        <BaseToast.Viewport className="fixed bottom-4 right-4 flex flex-col gap-2">
          <ToastList />
        </BaseToast.Viewport>
      </BaseToast.Portal>
    </BaseToast.Provider>
  );
}

function ToastList() {
  const { toasts } = BaseToast.useToastManager();
  return (
    <>
      {toasts.map((toast) => (
        <BaseToast.Root
          key={toast.id}
          toast={toast}
          className="rounded shadow-sm px-3 py-2 text-[13px] flex items-center gap-3"
          style={{ background: "var(--m-sheet)", border: "1px solid var(--m-line)", color: "var(--m-ink)" }}
        >
          <BaseToast.Title />
          {toast.actionProps && <BaseToast.Action className="font-semibold" style={{ color: "var(--m-accent)" }} />}
        </BaseToast.Root>
      ))}
    </>
  );
}
