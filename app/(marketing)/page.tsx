import Image from "next/image";
import Link from "next/link";
import {
  BookOpen,
  Check,
  LineChart,
  SlidersHorizontal,
  Stethoscope,
  Target,
  Timer,
} from "lucide-react";
import { HERO_IMAGE, unsplashUrl } from "@/lib/marketing-images";
import { Button } from "@/components/ui/button";
import { Logo } from "@/components/brand/logo";
import { PhoneMockup } from "@/components/marketing/phone-mockup";
import { PricingCards } from "@/components/marketing/pricing-cards";
import { listActivePlans, paidPlans } from "@/lib/plans";
import { priceLabel } from "@/lib/format";

function stats(startingPrice: string | null) {
  return [
    { value: "700+", label: "Doctors", note: "using cmeprep.me" },
    {
      value: "UNLIMITED",
      label: "Questions across 7 question banks",
      note: "+ 1 OSCE station bank",
    },
    startingPrice
      ? { value: startingPrice, label: "starting plans", note: "subscribe today!" }
      : { value: "FREE", label: "to start", note: "sign up today!" },
  ];
}

const FEATURES = [
  {
    icon: SlidersHorizontal,
    title: "Build any test",
    body: "Pick your subjects, topics, question count, difficulty and time limit. A ten-question drill on Cardiology, or a full paper across every subject.",
  },
  {
    icon: Timer,
    title: "Timed mock exams",
    body: "Sit under real exam conditions. The clock runs on our servers, so refreshing or closing your laptop never buys extra time — and never loses an answer.",
  },
  {
    icon: BookOpen,
    title: "Explanations that teach",
    body: "Every question carries a written explanation, not just a correct letter. Review your wrong answers and understand why the right one is right.",
  },
  {
    icon: Target,
    title: "Know your weak areas",
    body: "Per-topic accuracy after every paper, and a dashboard that surfaces your lowest-scoring topics — so your last weeks go where they count.",
  },
  {
    icon: LineChart,
    title: "Track every attempt",
    body: "Questions attempted, running accuracy, day streak and a full history of past papers, all updated the moment you submit.",
  },
  {
    icon: Stethoscope,
    title: "OSCE station bank",
    body: "An OSCE station bank alongside the written banks, drawn from past papers and intern recalls.",
  },
];

const EXAMINATIONS = [
  { code: "CAMC", name: "Caribbean Medical Board Exams" },
  { code: "USMLE Pt 1", name: "USA Medical Board Exams — Basic Sciences" },
  { code: "USMLE Pt 2 CK", name: "USA Medical Board Exams — Clinical Knowledge" },
  { code: "PLAB", name: "UK Medical Board Exams" },
  { code: "NCLEX", name: "USA Nursing Board Exams" },
  { code: "MBBS", name: "Exit Exams" },
  { code: "MCDN", name: "Nigerian Medical Board Exams" },
];

export default async function MarketingPage() {
  const plans = await listActivePlans();
  const paid = paidPlans(plans);
  const startingPrice =
    paid.length > 0
      ? priceLabel(Math.min(...paid.map((p) => p.price_cents)))
      : null;
  const STATS = stats(startingPrice);

  return (
    <>
      {/* ── Hero ─────────────────────────────────────────── */}
      <section className="relative isolate overflow-hidden bg-coral">
        {/* Photograph under a near-opaque brand scrim: warmth and context
            without competing with the headline. This uses the vivid --coral
            rather than --brand-surface because the ink layer below supplies
            the extra darkening — measured at 4.62:1 for white text against a
            worst-case white photo. A flat band with no scrim can't rely on
            that, which is why the CTA section still uses --brand-surface. */}
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
          className="absolute inset-0 -z-10 bg-coral/88"
        />
        <div aria-hidden="true" className="absolute inset-0 -z-10 bg-ink/25" />

        <div className="mx-auto w-full max-w-6xl px-4 py-16 sm:py-24">
          <div className="max-w-2xl text-white">
            <Logo
              href={null}
              size="lg"
              tagline="stacked"
              taglineClassName="text-white/90"
            />

            <h1 className="mt-8 font-display text-4xl leading-[1.12] font-semibold tracking-tight sm:text-5xl lg:text-[3.4rem]">
              Pass your Medical Board
              <br />
              and Exit Examinations
              <br />
              <span className="text-sun">Today!</span>
            </h1>

            <p className="mt-6 max-w-lg text-lg leading-relaxed text-white/90">
              Practice questions, timed mock exams and per-topic analytics that
              show you exactly where to focus.
            </p>

            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Button
                size="xl"
                className="bg-sun text-ink hover:bg-sun/85"
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

            <div className="mt-10 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-white/75">
              <span className="tracking-wide uppercase">powered by</span>
              <span className="rounded bg-white/15 px-2.5 py-1 font-medium tracking-wide">
                fuze arts
              </span>
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
            Built around how you actually revise — drill a topic, sit a full
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
                    className="mt-1 size-4 shrink-0 text-primary"
                    strokeWidth={3}
                    aria-hidden="true"
                  />
                  <span>
                    <span className="font-semibold">{exam.code}</span>{" "}
                    <span className="text-sm text-muted-foreground">
                      ({exam.name})
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
            Ten free questions and two practice tests — no card required.
          </p>
          <Button size="xl" className="bg-sun text-ink hover:bg-sun/85" asChild>
            <Link href="/register">Start a trial test</Link>
          </Button>
          <p className="text-sm text-white/80">www.cmeprep.me</p>
        </div>
      </section>
    </>
  );
}
