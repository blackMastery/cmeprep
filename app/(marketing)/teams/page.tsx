import type { Metadata } from "next";
import type { LucideIcon } from "lucide-react";
import {
  Check,
  FileClock,
  FolderLock,
  Headset,
  KeyRound,
  LayoutDashboard,
  ListChecks,
  Palette,
  Percent,
  Radar,
  Receipt,
  RefreshCw,
  ShieldCheck,
  SlidersHorizontal,
  Timer,
  UserCog,
  Users,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

export const metadata: Metadata = {
  title: "Teams & Enterprises",
  description:
    "Bring cmeprep.me to your hospital or training program: org accounts, SSO/SCIM, private question banks, audit logs, admin dashboards and volume pricing.",
};

const CONTACT_HREF =
  "mailto:support@cmeprep.me?subject=" +
  encodeURIComponent("Teams & Enterprises inquiry");

type OrgPlan = {
  name: string;
  price: string;
  seats: string;
  description: string;
  features: string[];
  featured?: boolean;
};

const ORG_PLANS: OrgPlan[] = [
  {
    name: "Team",
    price: "$1,200/year",
    seats: "Up to 90 users",
    description:
      "One flat price for schools and companies getting a cohort exam-ready together.",
    features: [
      "Up to 90 users",
      "Full access to every question bank and mock exams",
      "Shared analytics for program directors",
      "SSO / SAML login",
      "Audit logs",
      "Custom branding",
    ],
    featured: true,
  },
];

function planContactHref(planName: string) {
  return (
    "mailto:support@cmeprep.me?subject=" +
    encodeURIComponent(`${planName} plan inquiry`)
  );
}

type Feature = {
  icon: LucideIcon;
  title: string;
  body: string;
};

const CUSTOMIZATION: Feature[] = [
  {
    icon: Palette,
    title: "Custom branding",
    body: "Your organisation's logo and colours across the platform, so staff study in an environment that feels like yours.",
  },
  {
    icon: FolderLock,
    title: "Private question banks",
    body: "Question banks specific to your organisation — a hospital's own protocols and guidelines, alongside the general banks.",
  },
  {
    icon: SlidersHorizontal,
    title: "Configurable pass/fail thresholds",
    body: "Set pass marks by your organisation's own policy, not a fixed platform default.",
  },
];

const ORG_MANAGEMENT: Feature[] = [
  {
    icon: Users,
    title: "Org accounts up to 90 seats",
    body: "One organisation-level account covering your whole team — up to 90 users on the Team plan.",
  },
  {
    icon: UserCog,
    title: "Org-admin role",
    body: "Add and remove staff, see rosters at a glance and reassign licences as your team changes.",
  },
  {
    icon: KeyRound,
    title: "SSO / SAML",
    body: "Staff log in with the credentials they already have — no separate CMEPrep password to manage or forget.",
  },
  {
    icon: RefreshCw,
    title: "SCIM provisioning",
    body: "Accounts are created and removed automatically as staff join or leave, straight from your identity provider.",
  },
  {
    icon: FileClock,
    title: "Audit logs",
    body: "A record of who accessed what and when — often a compliance requirement in healthcare settings.",
  },
  {
    icon: LayoutDashboard,
    title: "Org-wide dashboard",
    body: "Completion status across all staff in one view, not just individual analytics.",
  },
];

const CONTENT_CONTROL: Feature[] = [
  {
    icon: ListChecks,
    title: "Assign content to teams",
    body: "Org-admins can assign specific subjects and question sets to specific teams — surgical residents see surgery, nursing staff see theirs.",
  },
  {
    icon: Timer,
    title: "Per-exam configuration",
    body: "Custom time limits or difficulty mix for each assigned exam, matched to how your programme actually tests.",
  },
];

const SUPPORT_TERMS: Feature[] = [
  {
    icon: Headset,
    title: "Dedicated account manager",
    body: "A named contact who knows your organisation — not just a support queue.",
  },
  {
    icon: ShieldCheck,
    title: "Priority support with an SLA",
    body: "Guaranteed response times, in writing, so issues never block a cohort mid-preparation.",
  },
  {
    icon: Receipt,
    title: "Annual invoicing & PO billing",
    body: "Invoice and purchase-order based billing on annual terms — no credit card required.",
  },
  {
    icon: Percent,
    title: "One flat annual price",
    body: "A single flat price covers your whole organisation — up to 90 users, no per-seat surprises.",
  },
];

const RISK_SIGNALS = [
  "Practice accuracy trending below the pass threshold",
  "Weak topics left unattempted close to exam day",
  "Mock-exam scores falling behind the cohort",
];

function FeatureGrid({
  id,
  title,
  intro,
  items,
  cols = 3,
  muted = false,
}: {
  id?: string;
  title: string;
  intro: string;
  items: Feature[];
  cols?: 2 | 3;
  muted?: boolean;
}) {
  return (
    <section
      id={id}
      className={muted ? "border-t border-border bg-secondary/30" : undefined}
    >
      <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20">
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            {title}
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">{intro}</p>
        </div>

        <ul
          className={
            cols === 3
              ? "mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3"
              : "mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2"
          }
        >
          {items.map((feature) => (
            <li key={feature.title} className="flex gap-4">
              <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-primary">
                <feature.icon className="size-5" aria-hidden="true" />
              </span>
              <div>
                <h3 className="font-display font-semibold">{feature.title}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
                  {feature.body}
                </p>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

export default function TeamsPage() {
  return (
    <>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="bg-brand-surface">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-24">
          <div className="max-w-2xl text-white">
            <span className="inline-block rounded-full bg-white/15 px-3 py-1 text-xs font-medium tracking-wide uppercase">
              For hospitals &amp; training programs
            </span>

            <h1 className="mt-6 font-display text-4xl leading-[1.12] font-semibold tracking-tight sm:text-5xl">
              CMEPrep for teams
              <br />
              and <span className="text-sun">enterprises</span>
            </h1>

            <p className="mt-6 max-w-lg text-lg leading-relaxed text-white/90">
              Org accounts, SSO, private question banks and org-wide analytics —
              everything your institution needs to prepare staff for their board
              examinations.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="xl" className="bg-sun text-ink hover:bg-sun/85" asChild>
                <a href={CONTACT_HREF}>Contact sales</a>
              </Button>
              <Button
                size="xl"
                className="border border-white/70 bg-transparent text-white hover:bg-white/15"
                asChild
              >
                <a href="#pricing">See plans &amp; pricing</a>
              </Button>
            </div>
          </div>
        </div>
      </section>

      <FeatureGrid
        id="customization"
        title="Customization"
        intro="Make the platform yours — your brand, your content, your standards."
        items={CUSTOMIZATION}
      />

      <FeatureGrid
        muted
        title="Org & access management"
        intro="Run your whole organisation from one account, with the identity and compliance controls your IT team expects."
        items={ORG_MANAGEMENT}
      />

      <FeatureGrid
        title="Content control"
        intro="Decide who studies what — and under which conditions."
        items={CONTENT_CONTROL}
        cols={2}
      />

      {/* ── Risk flagging ────────────────────────────────── */}
      <section className="border-t border-border bg-secondary/30">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:py-20 lg:grid-cols-2 lg:gap-16">
          <div>
            <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              See who&apos;s at risk — before exam day
            </h2>
            <p className="mt-3 text-lg text-muted-foreground">
              Risk flagging surfaces staff whose practice performance suggests
              they&apos;re likely to struggle on the real exam, while there&apos;s
              still time to intervene.
            </p>

            <ul className="mt-8 space-y-3">
              {RISK_SIGNALS.map((signal) => (
                <li key={signal} className="flex items-start gap-2.5">
                  <Check
                    className="mt-1 size-4 shrink-0 text-primary"
                    strokeWidth={3}
                    aria-hidden="true"
                  />
                  <span>{signal}</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex justify-center">
            <span className="flex size-40 items-center justify-center rounded-3xl bg-secondary text-primary">
              <Radar className="size-20" aria-hidden="true" strokeWidth={1.5} />
            </span>
          </div>
        </div>
      </section>

      <FeatureGrid
        title="Support & commercial terms"
        intro="Enterprise support and billing that works the way your organisation buys."
        items={SUPPORT_TERMS}
        cols={2}
      />

      {/* ── Pricing ──────────────────────────────────────── */}
      <section id="pricing" className="border-t border-border bg-secondary/30">
        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20">
          <div className="text-center">
            <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              One flat price for your whole organisation
            </h2>
            <p className="mt-3 text-muted-foreground">
              Coming soon. Contact us for early access or custom terms.
            </p>
          </div>

          <div className="mx-auto mt-12 grid max-w-md gap-6">
            {ORG_PLANS.map((plan) => (
              <div
                key={plan.name}
                className={cn(
                  "flex flex-col rounded-2xl p-7",
                  plan.featured
                    ? "bg-primary text-primary-foreground shadow-lg"
                    : "bg-card ring-1 ring-foreground/10"
                )}
              >
                {plan.featured && (
                  <span className="mb-4 self-start rounded-full bg-white/15 px-3 py-1 text-xs font-medium">
                    For schools &amp; companies
                  </span>
                )}

                <h3 className="font-display text-xl font-medium">
                  {plan.name}
                </h3>

                <p className="mt-3 flex items-baseline gap-3">
                  <span className="font-display text-4xl font-semibold">
                    {plan.price}
                  </span>
                  <span
                    className={cn(
                      "rounded-full px-3 py-1 text-xs font-medium tracking-wide uppercase",
                      plan.featured
                        ? "bg-white/15 text-primary-foreground"
                        : "bg-secondary text-primary"
                    )}
                  >
                    Coming soon
                  </span>
                </p>
                <p
                  className={cn(
                    "mt-1 text-sm",
                    plan.featured
                      ? "text-primary-foreground/75"
                      : "text-muted-foreground"
                  )}
                >
                  {plan.seats}, one flat price
                </p>

                <p
                  className={cn(
                    "mt-4 text-sm leading-relaxed",
                    plan.featured
                      ? "text-primary-foreground/85"
                      : "text-muted-foreground"
                  )}
                >
                  {plan.description}
                </p>

                <ul className="mt-6 flex-1 space-y-3 text-sm">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex items-start gap-2.5">
                      <Check
                        className={cn(
                          "mt-0.5 size-4 shrink-0",
                          plan.featured
                            ? "text-primary-foreground"
                            : "text-success"
                        )}
                        strokeWidth={3}
                        aria-hidden="true"
                      />
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>

                <Button
                  size="lg"
                  variant={plan.featured ? "secondary" : "default"}
                  className="mt-8 w-full"
                  asChild
                >
                  <a href={planContactHref(plan.name)}>Choose {plan.name}</a>
                </Button>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── Contact sales ────────────────────────────────── */}
      <section className="bg-brand-surface">
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-4 py-16 text-center text-white sm:py-20">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Bring CMEPrep to your organisation
          </h2>
          <p className="text-lg text-white/90">
            Tell us about your team and we&apos;ll put together the right plan.
          </p>
          <Button size="xl" className="bg-sun text-ink hover:bg-sun/85" asChild>
            <a href={CONTACT_HREF}>Contact sales</a>
          </Button>
          <p className="text-sm text-white/80">Or email support@cmeprep.me</p>
        </div>
      </section>
    </>
  );
}
