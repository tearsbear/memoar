"use client";

import {
  Fragment,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { useRouter } from "next/navigation";
import { Button } from "@astryxdesign/core/Button";
import { LibraryProvider, useLibrary } from "./library-provider";
import { LibraryConnection } from "./library-connection";
import { MemoarBrand } from "./memoar-brand";
import Grainient from "./grainient";

const titles = [
  "We bookmark so much,\nyet forget what’s meaningful.",
  "Save it now. Find it later.",
  "Let's do it.",
  "One last connection.",
];
const nextLabels = ["Get started", "Set up Memoar", "Check extension"];

function ExtensionCheck() {
  const library = useLibrary();
  const router = useRouter();
  useEffect(() => {
    if (
      library.connected &&
      !library.busy &&
      library.lastImport &&
      !library.error
    )
      router.replace("/app");
  }, [
    library.connected,
    library.busy,
    library.lastImport,
    library.error,
    router,
  ]);

  return library.loading ? (
    <p role="status" className="landing-description">
      Checking this browser…
    </p>
  ) : (
    <LibraryConnection />
  );
}

export function LandingOnboarding() {
  const [step, setStep] = useState(0);
  const heading = useRef<HTMLHeadingElement>(null);
  const words = titles[step]
    .split(/( |\n)/)
    .filter((t) => t !== " " && t !== "")
    .flatMap((t) => (t === "\n" ? ["\n"] : t.split(" ").filter(Boolean)));
  const revealStyle = {
    "--landing-reveal-delay": "260ms",
  } as CSSProperties;
  const previousStep = useRef(step);
  useEffect(() => {
    if (previousStep.current !== step) heading.current?.focus();
    previousStep.current = step;
  }, [step]);

  return (
    <main
      style={revealStyle}
      className={`setup-screen landing-onboarding${
        step === 0 ? " landing-welcome" : ""
      }`}
    >
      <Grainient
        className="landing-grainient"
        aria-hidden="true"
        colors={["#163b53", "#235c7d", "#3c89b3", "#72a8c4"]}
        angle={35}
        flow={0.9}
        silk={0.35}
        speed={0.8}
        grainAmount={0.05}
        grainAnimated={false}
        clickSwirl={false}
        intro={false}
        dpr={1.25}
      />
      <header className="landing-topbar">
        <button
          className="setup-brand"
          type="button"
          onClick={() => setStep(0)}
          aria-label="Back to welcome"
        >
          <MemoarBrand />
        </button>
        {step < 3 && (
          <button
            className="landing-text-button"
            type="button"
            onClick={() => setStep(3)}
          >
            Already installed?
          </button>
        )}
      </header>

      <div className="landing-stage">
        <section
          key={step}
          className={`landing-step landing-step-${step}`}
          aria-labelledby="landing-heading"
        >
          <h1
            id="landing-heading"
            ref={heading}
            tabIndex={-1}
            aria-label={titles[step].replace(/\n/g, " ")}
          >
            {words.map((word, index) =>
              word === "\n" ? (
                <br key={index} aria-hidden="true" />
              ) : (
                <Fragment key={index}>
                  {index > 0 && words[index - 1] !== "\n" && " "}
                  <span
                    className="landing-title-word"
                    aria-hidden="true"
                    style={{ animationDelay: `${Math.min(index * 60, 420)}ms` }}
                  >
                    {word}
                  </span>
                </Fragment>
              ),
            )}
          </h1>

          {step === 0 && (
            <>
              <p className="landing-description">
                Memoar is a place for the things that deserve to stay. <br />{" "}
                Ideas, moments, meaning.
              </p>
              <div className="landing-actions landing-welcome-action">
                <Button
                  label="Get started"
                  variant="primary"
                  size="lg"
                  onClick={() => setStep(1)}
                />
              </div>
            </>
          )}

          {step === 1 && (
            <>
              <p className="landing-description">
                A personal library for the things you want to come back to.
              </p>
              <ol className="landing-brief" role="list">
                <li>
                  <span className="landing-brief-icon" aria-hidden="true">
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="1.7"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path d="M8 3H3v5m13-5h5v5M3 16v5h5m8 0h5v-5M8 12h8m-4-4v8" />
                    </svg>
                  </span>
                  <div>
                    <h2>Capture a post</h2>
                    <p>
                      Open a supported post and click Add to Memoar. Your save
                      stays in this Chrome profile.
                    </p>
                  </div>
                </li>
                <li>
                  <span className="landing-brief-icon" aria-hidden="true">
                    <img
                      src="/platforms/meta.svg"
                      width="22"
                      height="22"
                      alt=""
                    />
                  </span>
                  <div>
                    <h2>Let Muse Spark organize it</h2>
                    <p>
                      Captured text and supported media go to Meta for topics,
                      summaries, and search keywords.
                    </p>
                  </div>
                </li>
                <li>
                  <span className="landing-brief-icon" aria-hidden="true">
                    <img
                      src="/icons/rediscover.svg"
                      width="20"
                      height="20"
                      alt=""
                    />
                  </span>
                  <div>
                    <h2>Find that idea again</h2>
                    <p>
                      Search your library, browse related posts, or return to a
                      collection.
                    </p>
                  </div>
                </li>
              </ol>
              <p className="landing-small">
                No account needed. Only save content you’re authorized to
                process.
              </p>
            </>
          )}

          {step === 2 && (
            <>
              <p className="landing-description">
                Download the extension, then add it to Chrome.
              </p>
              <a
                className="memoar-link-button landing-download"
                href="/api/extension/download"
              >
                Download extension ZIP
              </a>
              <ol className="landing-install">
                <li>
                  Extract <strong>memoar-extension.zip</strong> into a folder
                  you’ll keep.
                </li>
                <li>
                  Open <code>chrome://extensions</code> and turn on{" "}
                  <strong>Developer mode</strong>.
                </li>
                <li>
                  Click <strong>Load unpacked</strong> and choose the extracted
                  folder containing <code>manifest.json</code>.
                </li>
                <li>Pin Memoar in Chrome’s Extensions menu.</li>
              </ol>
              <p className="landing-small">
                The ZIP downloads to the location set in your browser, usually
                Downloads.
              </p>
            </>
          )}

          {step === 3 && (
            <LibraryProvider>
              <ExtensionCheck />
            </LibraryProvider>
          )}
        </section>
      </div>

      {step === 0 && (
        <div className="landing-welcome-support">
          <div className="landing-platforms" aria-label="Supported platforms">
            {["instagram", "threads", "facebook"].map((platform) => (
              <span key={platform}>
                <img
                  src={`/platforms/${platform}.svg`}
                  width="17"
                  height="17"
                  alt=""
                />
                {platform[0].toUpperCase() + platform.slice(1)}
              </span>
            ))}
          </div>
          <p className="landing-small">
            For Chrome desktop. Capture availability varies by post.
          </p>
        </div>
      )}

      {step > 0 && (
        <>
          <div key={step} className="landing-actions landing-navigation">
            {step > 0 && (
              <button
                className="landing-text-button"
                type="button"
                onClick={() => setStep((value) => value - 1)}
              >
                Back
              </button>
            )}
            {step < 3 && (
              <Button
                label={nextLabels[step]}
                variant={step === 2 ? "secondary" : "primary"}
                size="lg"
                onClick={() => setStep((value) => value + 1)}
              />
            )}
          </div>
          <p className="setup-footnote">
            Your library stays with this browser profile.
          </p>
        </>
      )}
    </main>
  );
}
