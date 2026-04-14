import * as React from "react"
import { cn } from "@/lib/utils"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      className={cn(
        "flex field-sizing-content min-h-20 w-full rounded-xl border border-[--border-subtle] bg-white px-3.5 py-3 text-sm text-[--text-primary] transition-all duration-200 outline-none placeholder:text-[--text-muted] hover:border-[--border-hover] focus-visible:border-primary/50 focus-visible:ring-2 focus-visible:ring-primary/15 disabled:pointer-events-none disabled:opacity-40",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
