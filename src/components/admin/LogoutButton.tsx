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
      className="admin-button admin-button-secondary inline-flex h-10 w-[3.5rem] min-w-0 shrink-0 items-center justify-center whitespace-nowrap rounded-lg border border-neutral-300 px-2 text-sm text-neutral-600 active:bg-neutral-100"
    >
      {pending ? "退出中…" : "退出"}
    </button>
  );
}
