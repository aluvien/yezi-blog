"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

export default function LogoutButton() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      type="button"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await fetch("/api/admin/logout", { method: "POST" });
          router.replace("/admin/login");
          router.refresh();
        })
      }
      className="inline-flex h-10 min-w-[5rem] shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-neutral-300 px-3 text-sm text-neutral-600 active:bg-neutral-100"
    >
      {pending ? "退出中…" : "退出"}
    </button>
  );
}
