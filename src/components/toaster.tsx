"use client";

import { useTheme } from "next-themes";
import { Toaster, toast } from "sonner";
import { CheckIcon, InfoIcon, SpinnerIcon, WarningIcon, XCircleIcon } from "@/components/icons";

export { toast };

/**
 * Toast notifications (sonner). Mounted once in the root layout; every admin
 * action – create / update / delete / toggle – reports through it instead of an
 * in-page banner (see `components/admin/flash-toast.tsx`). Follows the theme.
 */
export function AppToaster() {
  const { resolvedTheme } = useTheme();
  return (
    <Toaster
      theme={resolvedTheme === "dark" ? "dark" : resolvedTheme === "light" ? "light" : "system"}
      position="top-right"
      offset={{ top: 80 }}
      mobileOffset={{ top: 72 }}
      richColors
      closeButton
      duration={4500}
      visibleToasts={4}
      icons={{
        success: <CheckIcon className="h-4 w-4" />,
        error: <XCircleIcon className="h-4 w-4" />,
        warning: <WarningIcon className="h-4 w-4" />,
        info: <InfoIcon className="h-4 w-4" />,
        loading: <SpinnerIcon className="h-4 w-4 animate-spin" />,
      }}
      toastOptions={{
        classNames: {
          toast: "!rounded-xl !border !shadow-lg !font-sans",
          title: "!text-sm !font-semibold",
          description: "!text-xs",
          closeButton: "!border-neutral-200 !bg-white !text-neutral-500 hover:!text-neutral-900 dark:!border-neutral-700 dark:!bg-neutral-800 dark:!text-neutral-300",
        },
      }}
    />
  );
}
