"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Wand2 } from "lucide-react";
import { PromptDrawer } from "./prompt-drawer";
import { useTranslations } from "next-intl";

interface PromptEditButtonProps {
  promptKeys: string | string[];
  projectId?: string;
  /** Custom label; defaults to prompt template name */
  label?: string;
  variant?: "ghost" | "outline";
  size?: "xs" | "sm";
}

export function PromptEditButton({
  promptKeys,
  projectId,
  label,
  variant = "outline",
  size = "sm",
}: PromptEditButtonProps) {
  const [open, setOpen] = useState(false);
  const t = useTranslations("promptTemplates");

  return (
    <>
      <Button
        variant={variant}
        size={size}
        onClick={() => setOpen(true)}
      >
        <Wand2 className="h-3.5 w-3.5" />
        {label ?? t("editPrompt")}
      </Button>
      <PromptDrawer
        open={open}
        onOpenChange={setOpen}
        promptKeys={promptKeys}
        projectId={projectId}
      />
    </>
  );
}
