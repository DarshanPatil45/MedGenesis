import * as Dialog from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ReactNode } from 'react'
import { cn } from '../cn'

/**
 * Right-side contextual drawer built on Radix Dialog — inherits focus
 * trapping, Escape-to-close, scroll locking and `aria-modal` for free.
 * Animation is CSS keyed off Radix's `data-state`, so it degrades
 * correctly under `prefers-reduced-motion` via the global override.
 */
export function Drawer({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  width = 'md',
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description?: string
  children: ReactNode
  footer?: ReactNode
  width?: 'md' | 'lg'
}) {
  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-[#0b1220]/40 backdrop-blur-sm data-[state=closed]:animate-out data-[state=closed]:fade-out data-[state=open]:animate-in data-[state=open]:fade-in" />
        <Dialog.Content
          className={cn(
            'fixed inset-y-0 right-0 z-50 flex w-full flex-col border-l border-border-strong bg-surface shadow-2xl outline-none',
            'data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right data-[state=closed]:animate-out data-[state=open]:animate-in duration-300',
            width === 'lg' ? 'max-w-2xl' : 'max-w-lg',
          )}
        >
          <div className="flex shrink-0 items-start justify-between gap-4 border-b border-border-strong px-5 py-4 sm:px-6">
            <div className="min-w-0">
              <Dialog.Title className="font-sans text-base font-semibold text-ink">{title}</Dialog.Title>
              {description && (
                <Dialog.Description className="mt-1 text-xs leading-relaxed text-ink-2">
                  {description}
                </Dialog.Description>
              )}
            </div>
            <Dialog.Close
              aria-label="Close"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border border-border-strong text-ink-2 transition-colors hover:bg-subtle hover:text-ink"
            >
              <X size={16} />
            </Dialog.Close>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>

          {footer && (
            <div className="shrink-0 border-t border-border-strong bg-surface px-5 py-4 sm:px-6">{footer}</div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
