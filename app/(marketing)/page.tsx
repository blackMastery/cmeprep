import Image from "next/image";
import Link from "next/link";
import {
  Bookmark,
  BookOpen,
  Building2,
  Check,
  Lightbulb,
  LineChart,
  SlidersHorizontal,
  Sparkles,
  Stethoscope,
  Target,
  Timer,
} from "lucide-react";
import { HERO_IMAGE, unsplashUrl } from "@/lib/marketing-images";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { PhoneMockup } from "@/components/marketing/phone-mockup";
import { SocialLinks } from "@/components/marketing/social-links";
import { TutorMockup } from "@/components/marketing/tutor-mockup";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { MarketingStructuredData } from "@/components/marketing/structured-data";
import { listActivePlans, paidPlans } from "@/lib/plans";
import { listEnabledLanguageCodes } from "@/lib/translations";
import { languageByCode } from "@/lib/translation-core";
import { priceLabel } from "@/lib/format";
import { TUTOR_DAILY_CAP, TUTOR_TRIAL_ALLOWANCE } from "@/lib/tutor-core";

function stats(startingPrice: string | null) {
  return [
    {
      value: "700+",
      label: "Doctors",
      note: "using the cmeqbank.com study group",
      // The study groups live on WhatsApp/Facebook, so this tile is where a
      // visitor expects to find the way in.
      social: true,
    },
    {
      value: "UNLIMITED",
      label: "Questions answered",
      note: "with the AI tutor",
    },
    startingPrice
      ? { value: startingPrice, label: "starting plans", note: "subscribe today!" }
      : { value: "FREE", label: "to start", note: "sign up today!" },
  ];
}

/** Local files under public/images — no remotePatterns entry needed. */
const RECOGNITION = [
  {
    src: "/images/image4.jpeg",
    alt: "SelectUSA Investment Summit 2026 badge for Raule Williams, Complete Medical Examinations Prep, Guyana",
    width: 1026,
    height: 1259,
  },
  {
    src: "/images/image3.jpeg",
    alt: "2023–2024 Guyana Innovation Prize awardee: Raule Williams, CMEPrep",
    width: 1080,
    height: 1278,
  },
];

const FEATURES = [
  {
    icon: SlidersHorizontal,
    title: "Build any test",
    body: "Pick your subjects, question count, difficulty and time limit. A ten-question drill on Cardiology, or a full paper across every subject.",
  },
  {
    icon: Timer,
    title: "Timed mock exams",
    body: "Sit under real exam conditions. The clock runs on our servers, so refreshing or closing your laptop never buys extra time — and never loses an answer.",
  },
  {
    icon: Lightbulb,
    title: "Tutor mode",
    body: "Untimed practice that grades each question the moment you answer and shows the explanation right there — so you learn as you go, not after the paper.",
  },
  {
    icon: Sparkles,
    title: "AI tutor",
    body: "Ask anything, any time. The tutor answers from curated course materials, cites the file and page it used, and says so when a topic isn't covered instead of guessing.",
  },
  {
    icon: Stethoscope,
    title: "AI-graded OSCE stations",
    body: "Write your answer to a station in your own words. An AI examiner marks it against the model answer in seconds, then shows you the model answer to learn from.",
  },
  {
    icon: BookOpen,
    title: "Explanations that teach",
    body: "Every question carries a written explanation, not just a correct letter. Review your wrong answers and understand why the right one is right.",
  },
  {
    icon: Target,
    title: "Know your weak areas",
    body: "Per-subject accuracy after every paper, and a dashboard that surfaces your lowest-scoring subjects — so your last weeks go where they count.",
  },
  {
    icon: LineChart,
    title: "Track every attempt",
    body: "Questions attempted, running accuracy, day streak and a full history of past papers, all updated the moment you submit.",
  },
  {
    icon: Bookmark,
    title: "Bookmarks & notes",
    body: "Bookmark the questions that caught you out and keep your own notes on any of them, so they're one click away in your last week.",
  },
];

/** Why the tutor is worth asking — every line here is a rule the product
 * actually enforces (README "AI tutor", lib/tutor-core.ts). The allowances
 * are imported rather than typed so the page can't promise more than the
 * proxy route grants. */
const TUTOR_POINTS = [
  "Every answer cites its sources — the file and the page — so you can check it against your own copy.",
  "If the materials don't cover something, it says so. No confident guesses, no invented doses.",
  "Ask follow-ups. Your conversation is saved, so you can pick up tomorrow where you left off tonight.",
  "Rate any answer good or bad — feedback goes straight to our content team.",
  `${TUTOR_TRIAL_ALLOWANCE} questions free on trial, then ${TUTOR_DAILY_CAP} a day on any subscription.`,
];

const EXAMINATIONS = [
  { code: "CAMC", name: "Caribbean Medical Board Exams" },
  { code: "USMLE Pt. 1", name: "USA Medical Board Exams — Basic Sciences" },
  { code: "USMLE Pt. 2 CK", name: "USA Medical Board Exams — Clinical Knowledge" },
  { code: "PLAB", name: "UK Medical Board Exams" },
  { code: "NCLEX", name: "USA Nursing Board Exams" },
  { code: "MBBS", name: "Exit Exams" },
  {
    code: "Practical OSCE",
    name: "Objective Structured Clinical Examination",
  },
];

// No metadata export on purpose: the root layout's title, description,
// canonical "/" and openGraph already describe this page exactly. Declaring
// a partial `openGraph` here would REPLACE the root's and drop og:image.

export default async function MarketingPage() {
  const [plans, enabledLanguageCodes] = await Promise.all([
    listActivePlans(),
    listEnabledLanguageCodes(),
  ]);
  const paid = paidPlans(plans);
  const lowestCents =
    paid.length > 0 ? Math.min(...paid.map((p) => p.price_cents)) : null;
  const startingPrice = lowestCents !== null ? priceLabel(lowestCents) : null;
  const STATS = stats(startingPrice);

  return (
    <>
      <MarketingStructuredData
        startingPrice={lowestCents !== null ? lowestCents / 100 : undefined}
        languages={enabledLanguageCodes.flatMap((code) => {
          const l = languageByCode(code);
          return l ? [{ code, name: l.name }] : [];
        })}
      />
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden bg-brand-surface">
        {/* Photograph under a near-opaque brand scrim: warmth and context
            without competing with the headline. --brand-surface rather than
            the --crimson primitive because the marketing pages are not
            theme-forced and the primitive lifts to rose in dark mode. The
            crimson is dark enough that no extra ink layer is needed: a
            worst-case white photo under the 90% scrim lands at ~#872b3e,
            8.6:1 for white text. */}
        <Image
          src={unsplashUrl(HERO_IMAGE.src, 2000)}
          alt=""
          fill
          priority
          sizes="100vw"
          className="-z-10 object-cover"
          style={{ objectPosition: HERO_IMAGE.position }}
        />
        <div
          aria-hidden="true"
          className="absolute inset-0 -z-10 bg-brand-surface/90"
        />

        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-24">
          <div className="max-w-2xl text-white">
            {/* The lockup image carries its own crimson field, which is
                darker than or equal to this band everywhere; `lighten` keeps
                the per-channel maximum, so the field dissolves into the band
                while the white wordmark, coral tile and gold tagline survive.
                The section is `isolate`, so the blend can't reach outside. */}
            <Logo
              href={null}
              size="lg"
              tagline="stacked"
              taglineClassName="text-white/90"
              className="mix-blend-lighten"
            />

            <Link
              href="#tutor"
              className="mt-8 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-medium tracking-wide uppercase hover:bg-white/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white/60"
            >
              <Sparkles className="size-3.5 text-gold" aria-hidden="true" />
              New · an AI tutor that cites its sources
            </Link>

            <h1 className="mt-5 font-display text-4xl leading-[1.12] font-semibold tracking-tight sm:text-5xl lg:text-[3.4rem]">
              Pass your Medical Board
              <br />
              and Exit Examinations
              <br />
              <span className="text-gold">Today!</span>
            </h1>

            <p className="mt-6 max-w-lg text-lg leading-relaxed text-white/90">
              Practice questions, timed mock exams, AI-graded OSCE stations and
              an AI tutor that answers from the course materials — with
              per-subject analytics that show you exactly where to focus.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              {/* A crimson focus ring on a crimson band is invisible, so the
                  gold CTAs ring in white. */}
              <Button
                size="xl"
                className="bg-gold text-ink hover:bg-gold-deep focus-visible:border-white/60 focus-visible:ring-white/50"
                asChild
              >
                <Link href="/register">Start a trial test</Link>
              </Button>
              <Button
                size="xl"
                className="border border-white/70 bg-transparent text-white hover:bg-white/15"
                asChild
              >
                <Link href="#features">See what&apos;s included</Link>
              </Button>
            </div>

          </div>
        </div>
      </section>

      {/* ── Stats ────────────────────────────────────────── */}
      <section className="border-b border-border">
        <dl className="mx-auto grid w-full max-w-6xl gap-10 px-4 py-14 text-center sm:grid-cols-3">
          {STATS.map((stat) => (
            <div key={stat.label}>
              <dt className="sr-only">{stat.label}</dt>
              <dd>
                <span className="block font-display text-4xl font-bold text-primary sm:text-5xl">
                  {stat.value}
                </span>
                <span className="mt-2 block font-medium">{stat.label}</span>
                <span className="mt-0.5 block text-sm text-muted-foreground">
                  {stat.note}
                </span>
                {"social" in stat && stat.social ? (
                  <SocialLinks
                    label="Join our study groups"
                    className="mt-3 justify-center"
                    linkClassName="text-muted-foreground hover:text-foreground"
                  />
                ) : null}
              </dd>
            </div>
          ))}
        </dl>
      </section>

      {/* ── Features ─────────────────────────────────────── */}
      <section
        id="features"
        className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-20"
      >
        <div className="max-w-2xl">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Everything you need to walk in prepared
          </h2>
          <p className="mt-3 text-lg text-muted-foreground">
            Built around how you actually revise — drill a subject, sit a full
            paper, then find out what to fix.
          </p>
        </div>

        <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
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
      </section>

      {/* ── AI tutor ─────────────────────────────────────── */}
      <section id="tutor" className="scroll-mt-20 border-t border-border">
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 py-16 sm:py-20 lg:grid-cols-2 lg:gap-16">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-accent px-3 py-1 text-xs font-medium tracking-wide text-primary uppercase">
              <Sparkles className="size-3.5" aria-hidden="true" />
              AI tutor
            </span>
            <h2 className="mt-4 font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              Your questions, answered from the syllabus
            </h2>
            <p className="mt-3 text-lg text-muted-foreground">
              Stuck on a concept at 11pm? Ask the tutor. It answers only from
              the curated course materials behind the question bank — never
              from the open internet — so every answer is one you can trace
              back to the page.
            </p>

            <ul className="mt-8 space-y-3">
              {TUTOR_POINTS.map((point) => (
                <li key={point} className="flex items-start gap-2.5">
                  <Check
                    className="mt-1 size-4 shrink-0 text-teal"
                    strokeWidth={3}
                    aria-hidden="true"
                  />
                  <span>{point}</span>
                </li>
              ))}
            </ul>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button size="lg" asChild>
                <Link href="/register">Ask your first question free</Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link href="#pricing">See plans</Link>
              </Button>
            </div>
          </div>

          <div className="flex justify-center">
            <TutorMockup />
          </div>
        </div>
      </section>

      {/* ── Examinations + device shot ───────────────────── */}
      <section
        id="examinations"
        className="border-t border-border bg-secondary/30 py-16 sm:py-20"
      >
        <div className="mx-auto grid w-full max-w-6xl items-center gap-12 px-4 lg:grid-cols-2 lg:gap-16">
          <div className="flex justify-center">
            <PhoneMockup />
          </div>

          <div>
            <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              One platform, seven examinations
            </h2>
            <p className="mt-3 text-muted-foreground">
              Question banks mapped to the exam you&apos;re actually sitting.
            </p>

            <ul className="mt-8 space-y-3">
              {EXAMINATIONS.map((exam) => (
                <li key={exam.code} className="flex items-start gap-2.5">
                  <Check
                    className="mt-1 size-4 shrink-0 text-teal"
                    strokeWidth={3}
                    aria-hidden="true"
                  />
                  <span>
                    {/* Description leads, abbreviation trails in brackets —
                        the exam someone is sitting is the thing they scan for,
                        not the acronym. */}
                    <span className="font-semibold">{exam.name}</span>{" "}
                    <span className="text-sm text-muted-foreground">
                      ({exam.code})
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* ── Pricing ──────────────────────────────────────── */}
      {plans.length > 0 && (
        <section id="pricing" className="border-t border-border py-16 sm:py-20">
          <div className="mx-auto w-full max-w-6xl px-4">
            <div className="text-center">
              <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
                {startingPrice
                  ? `Plans start at ${startingPrice}`
                  : "Start free today"}
              </h2>
              <p className="mt-3 text-muted-foreground">
                Start free, subscribe when you&apos;re ready.
              </p>
            </div>

            <div className="mt-10 flex flex-col gap-6 bg-brand-surface p-8 text-white sm:flex-row sm:items-center sm:justify-between sm:px-10 sm:py-9">
              <div className="flex gap-4">
                <Building2
                  className="mt-0.5 size-8 shrink-0 text-gold"
                  aria-hidden="true"
                />
                <div>
                  <p className="font-display text-xl font-semibold tracking-tight sm:text-2xl">
                    Teams &amp; Enterprises
                  </p>
                  <p className="mt-2 max-w-xl text-sm leading-relaxed text-white/90 sm:text-base">
                    Org accounts, SSO, private question banks and shared
                    analytics for hospitals, schools and training programs.
                  </p>
                  <p className="mt-2 text-xs font-medium tracking-wide text-gold uppercase">
                    Coming soon
                  </p>
                </div>
              </div>
              <Button
                size="lg"
                className="shrink-0 bg-gold text-ink hover:bg-gold-deep focus-visible:border-white/60 focus-visible:ring-white/50"
                asChild
              >
                <Link href="/teams">Learn more</Link>
              </Button>
            </div>

            <PricingCards plans={plans} />
          </div>
        </section>
      )}

      {/* ── Start today ──────────────────────────────────── */}
      <section className="bg-brand-surface">
        <div className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-4 py-16 text-center text-white sm:py-20">
          <h2 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
            Start today
          </h2>
          <p className="text-lg text-white/90">
            Ten free questions, two practice tests and {TUTOR_TRIAL_ALLOWANCE}{" "}
            AI tutor questions — no card required.
          </p>
          <Button size="xl" className="bg-gold text-ink hover:bg-gold-deep focus-visible:border-white/60 focus-visible:ring-white/50" asChild>
            <Link href="/register">Start a trial test</Link>
          </Button>
          <p className="text-sm text-white/80">www.cmeqbank.com</p>
        </div>
      </section>

      {/* ── Recognition ──────────────────────────────────── */}
      <section aria-label="Recognition" className="border-t border-border">
        <ul className="mx-auto grid w-full max-w-4xl grid-cols-2 gap-6 px-4 py-12 sm:gap-10 sm:py-16">
          {RECOGNITION.map((item) => (
            <li key={item.src}>
              <Image
                src={item.src}
                alt={item.alt}
                width={item.width}
                height={item.height}
                sizes="(min-width: 640px) 448px, 50vw"
                className="mx-auto h-auto w-full max-w-md rounded-xl"
              />
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}
