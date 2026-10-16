import { useEffect, useId, useRef } from "react";

/**
 * Asks before something that cannot be undone. The browser's own modal
 * `<dialog>`: it keeps focus inside, dims the page behind and answers Escape
 * by itself. Mounted to ask, unmounted once answered. Focus starts on the
 * button that keeps things as they are, so a stray Enter changes nothing.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const messageId = useId();

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog === null) return;
    dialog.showModal();
    cancelRef.current?.focus();
    return () => dialog.close();
  }, []);

  return (
    <dialog
      ref={dialogRef}
      className="dialog"
      aria-labelledby={titleId}
      aria-describedby={messageId}
      onCancel={(event) => {
        // Escape: the parent unmounts the dialog, which closes it.
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id={titleId} className="dialog__title">
        {title}
      </h2>
      <p id={messageId} className="dialog__message">
        {message}
      </p>
      <div className="dialog__actions">
        <button ref={cancelRef} type="button" className="button" onClick={onCancel}>
          {cancelLabel}
        </button>
        <button type="button" className="button button--danger" onClick={onConfirm}>
          {confirmLabel}
        </button>
      </div>
    </dialog>
  );
}
