"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { Compass, PlusCircle, HelpCircle, UserCircle } from "lucide-react";

export function NavBar() {
  const pathname = usePathname();

  // Check if we're on a rig detail page
  const isRigPage = pathname.startsWith("/rig/");

  const navItems: Array<{
    href: "/explore" | "/launch" | "/info" | "/profile";
    icon: typeof Compass;
    isActive: boolean;
  }> = [
    { href: "/explore", icon: Compass, isActive: pathname === "/explore" || pathname === "/" || isRigPage },
    { href: "/launch", icon: PlusCircle, isActive: pathname === "/launch" },
    { href: "/info", icon: HelpCircle, isActive: pathname === "/info" },
    { href: "/profile", icon: UserCircle, isActive: pathname === "/profile" },
  ];

  return (
    <nav
      className="fixed bottom-0 left-0 right-0 z-50 flex justify-center bg-zinc-800"
    >
      <div
        className="flex justify-around items-center w-full max-w-[520px] bg-background px-8"
        style={{
          paddingBottom: "calc(env(safe-area-inset-bottom, 0px) + 12px)",
          paddingTop: "12px",
        }}
      >
        {navItems.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="flex items-center justify-center p-2 transition-colors"
          >
            <item.icon
              className={cn(
                "w-6 h-6 transition-colors",
                item.isActive
                  ? "text-white"
                  : "text-zinc-500 hover:text-zinc-300"
              )}
              strokeWidth={1.5}
            />
          </Link>
        ))}
      </div>
    </nav>
  );
}
