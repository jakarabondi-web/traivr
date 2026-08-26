import Link from "next/link";

import { brand } from "@/config/brand";
import { LogoLockup } from "@/components/shared/logo-lockup";

const COLUMNS: Array<{ title: string; links: Array<{ href: string; label: string }> }> = [
  {
    title: "Product",
    links: [
      { href: "/services", label: "Solutions" },
      { href: "/security", label: "Security" },
      { href: "/pricing", label: "Pricing" },
      { href: "/resources", label: "Resources" },
    ],
  },
  {
    title: "Solutions",
    links: [
      { href: "/for-companies", label: "For AI companies" },
      { href: "/for-experts", label: "For experts" },
      { href: "/apply", label: "Apply to join" },
    ],
  },
  {
    title: "Company",
    links: [
      { href: "/about", label: "About" },
      { href: "/contact", label: "Contact sales" },
      { href: "/status", label: "Status" },
    ],
  },
  {
    title: "Legal",
    links: [
      { href: "/legal/privacy", label: "Privacy" },
      { href: "/legal/terms", label: "Terms" },
      { href: "/legal/sla", label: "Service level agreement" },
      { href: "/security/sub-processors", label: "Sub-processors" },
      { href: "/legal/cookies", label: "Cookie preferences" },
    ],
  },
];

export function SiteFooter() {
  return (
    <footer className="border-t border-border bg-surface">
      <div className="mx-auto max-w-7xl px-4 py-14 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 gap-x-6 gap-y-10 sm:gap-8 md:grid-cols-6">
          <div className="col-span-2">
            <Link href="/" aria-label={brand.name} className="inline-flex items-center">
              <LogoLockup className="h-12 w-auto" />
            </Link>
            <p className="mt-3 max-w-xs text-sm text-muted-foreground">{brand.tagline}</p>
          </div>
          {COLUMNS.map((col) => (
            <div key={col.title}>
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{col.title}</p>
              {/* py-2 on each link (instead of relying on text-sm
                  line-height + a gap between list items) gives each row a
                  real tap target, not just a thin line of text. */}
              <ul className="mt-1">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="block py-2 text-sm text-muted-foreground hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <div className="mt-8 flex flex-col items-center gap-4 border-t border-border pt-6 text-center sm:flex-row sm:items-center sm:justify-between sm:text-left">
          <p className="text-xs text-muted-foreground">
            © {new Date().getFullYear()} {brand.legalName}. All rights reserved.
          </p>
          <div className="flex gap-5 text-xs text-muted-foreground">
            <a href={brand.social.linkedin} className="py-1.5 hover:text-foreground">
              LinkedIn
            </a>
            <a href={brand.social.twitter} className="py-1.5 hover:text-foreground">
              X / Twitter
            </a>
          </div>
        </div>
      </div>
    </footer>
  );
}
