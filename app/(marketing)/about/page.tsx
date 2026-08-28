import type { Metadata } from "next";
import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";
import {
  OG_IMAGE,
  SITE_NAME,
  SUPPORT_EMAIL,
  TWITTER_IMAGE,
  WHATSAPP_DISPLAY,
  WHATSAPP_HREF,
} from "@/lib/site";
import { getCurrentUser } from "@/lib/auth";
import { Button } from "@/components/ui/button";
import { EcgDivider } from "@/components/brand/ecg-line";
import { ContactForm } from "@/components/marketing/contact-form";
import { SocialLinks } from "@/components/marketing/social-links";

const ABOUT_TITLE = "About";
const ABOUT_DESCRIPTION =
  "Why we built Complete Medical Examinations Prep (CMEPrep) — the first and only interactive question bank for medical board and exit examinations.";

export const metadata: Metadata = {
  title: ABOUT_TITLE,
  description: ABOUT_DESCRIPTION,
  alternates: { canonical: "/about" },
  // `images` is repeated here deliberately — declaring openGraph/twitter at
  // page level replaces the root's instead of merging, so omitting it would
  // strip og:image from this page. See lib/site.ts.
  openGraph: {
    url: "/about",
    title: `${ABOUT_TITLE} · ${SITE_NAME}`,
    description: ABOUT_DESCRIPTION,
    images: [OG_IMAGE],
  },
  twitter: {
    title: `${ABOUT_TITLE} · ${SITE_NAME}`,
    description: ABOUT_DESCRIPTION,
    images: [TWITTER_IMAGE],
  },
};

type AboutSection = {
  heading: string;
  /** One paragraph per entry, rendered in order. */
  body: readonly string[];
};

/**
 * Page copy lives here rather than inline so adding a section is a data edit.
 *
 * Only sections with real copy belong in this array — an unfinished one must
 * never render placeholder text on a live marketing page. The commented
 * entries below are the agreed shape, waiting on wording.
 */
const SECTIONS: readonly AboutSection[] = [
  {
    heading: "Who are we?",
    body: [
      "Complete Medical Examinations Prep (CMEPrep) was created to provide high-quality, practical exam prep tools to students. We offer the most recent recall questions from board exams and develop them for you. We saw frustration and low confidence among exam takers not knowing what to expect to come on exams, so we built the first and only interactive question bank designed just for you! Feel free to join our study groups.",
    ],
  },
  // {
  //   heading: "Our mission",
  //   body: ["…"],
  // },
  {
    heading: "What we offer",
    body: [
      "Question banks for seven examinations — CAMC, USMLE, PLAB, NCLEX, MBBS exit exams and the practical OSCE — built from past papers and intern recalls, with a written explanation on every question. Build a ten-question drill or sit a full timed paper, then let the dashboard show you where to focus.",
      "And when a question raises a question, ask the AI tutor. It answers only from our curated course materials, cites the file and page behind every answer, and tells you when something isn't covered rather than guessing. OSCE stations are marked the same way: write the answer in your own words and an AI examiner grades it against the model answer in seconds.",
    ],
  },
];

export default async function AboutPage() {
  // Only to pre-fill the reply-to address — a signed-in visitor should not
  // have to retype what we already know.
  const user = await getCurrentUser();

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-12 sm:py-16">
      {SECTIONS.map((section, index) => (
        <section key={section.heading}>
          {index > 0 && <EcgDivider className="my-12" />}

          {index === 0 ? (
            <h1 className="font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {section.heading}
            </h1>
          ) : (
            <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
              {section.heading}
            </h2>
          )}

          {section.body.map((paragraph) => (
            <p
              key={paragraph.slice(0, 32)}
              className="mt-6 text-lg leading-relaxed text-muted-foreground"
            >
              {paragraph}
            </p>
          ))}
        </section>
      ))}

      <EcgDivider className="my-12" />

      <section id="contact" className="scroll-mt-20">
        <h2 className="font-display text-2xl font-semibold tracking-tight sm:text-3xl">
          Contact us
        </h2>
        <p className="mt-3 text-lg leading-relaxed text-muted-foreground">
          Questions about a plan, a question in the bank, or access for your
          institution? Send us a message and we&apos;ll come back to you.
        </p>

        <div className="mt-8 rounded-2xl border border-border p-6 sm:p-7">
          <ContactForm defaultEmail={user?.email} />
        </div>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
          <div className="space-y-1.5">
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <Mail className="size-4 shrink-0" aria-hidden="true" />
              Prefer email?
              <a
                href={`mailto:${SUPPORT_EMAIL}`}
                className="font-medium text-primary underline underline-offset-2"
              >
                {SUPPORT_EMAIL}
              </a>
            </p>
            <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
              <MessageCircle className="size-4 shrink-0" aria-hidden="true" />
              WhatsApp
              <a
                href={WHATSAPP_HREF}
                target="_blank"
                rel="noopener noreferrer"
                className="font-medium text-primary underline underline-offset-2"
              >
                {WHATSAPP_DISPLAY}
              </a>
            </p>
          </div>
          <SocialLinks
            linkClassName="text-muted-foreground hover:text-foreground"
          />
        </div>
      </section>

      <EcgDivider className="my-12" />

      <section className="rounded-2xl bg-secondary/40 p-7">
        <h2 className="font-display text-2xl font-semibold tracking-tight">
          Start practising
        </h2>
        <p className="mt-2 text-muted-foreground">
          Try it free, then pick the plan that matches the examination you are
          preparing for.
        </p>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Button size="lg" asChild>
            <Link href="/register">Start free</Link>
          </Button>
          <Button size="lg" variant="outline" asChild>
            <Link href="/#pricing">See pricing</Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
