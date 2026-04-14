"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center font-medium whitespace-nowrap transition-all duration-200 outline-none select-none focus-visible:ring-2 focus-visible:ring-primary/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-white rounded-xl shadow-lg shadow-primary/20 hover:bg-[#E8573A] hover:shadow-xl hover:shadow-primary/30 active:scale-[0.97]",
        outline:
          "rounded-xl border border-border bg-transparent text-[--text-secondary] hover:bg-[--surface-hover] hover:text-[--text-primary] hover:border-[--border-hover]",
        secondary:
          "rounded-xl bg-secondary text-secondary-foreground hover:bg-[--surface-hover]",
        ghost:
          "rounded-xl text-[--text-secondary] hover:bg-[--surface-hover] hover:text-[--text-primary]",
        destructive:
          "rounded-xl bg-destructive/10 text-destructive hover:bg-destructive/20",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 gap-2 px-4 text-sm rounded-xl",
        xs: "h-7 gap-1 px-2.5 text-xs rounded-lg [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3 text-[13px] rounded-lg",
        lg: "h-11 gap-2 px-6 text-base rounded-xl",
        icon: "size-9 rounded-xl",
        "icon-xs": "size-7 rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8 rounded-lg",
        "icon-lg": "size-11 rounded-xl",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
