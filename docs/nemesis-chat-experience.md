# Nemesis chat reading and loading behavior

## Result positioning

`use-nemesis-chat-scroll.ts` replaces the old unconditional `scrollTop = scrollHeight` effect.

- Sending a request brings its loading card into view. Success and error responses align their **beginning** with the top padding of the chat viewport, not the bottom of the result.
- The latest response/loading slot reserves at least one viewport of reading room. Even a short result can align at the top without the browser clamping it back to the bottom. Earlier turns return to their natural height when another request starts.
- Wheel, touch, scrollbar-pointer and scrolling-key interaction stops following the pending turn. An administrator reading previous messages is not pulled to the result on completion. A new submission opts into following its own turn again.
- Expanding tool details, revealing loaded product rows, paging reports, approving actions and animation frames do not request scrolling. Browser scroll anchoring is disabled for this container to avoid a second, implicit scroll policy.
- A callback ref handles modal/portal mounts, restores the reading position when reopened, and measures the viewport with a cleaned-up ResizeObserver. CSS variables reserve reading space without resize-driven React state updates. Only the thread is scrolled; document scroll and keyboard focus are not moved.

## Scrollbar

The chat viewport has a five-pixel rounded scrollbar thumb in a tint of the current theme's primary color, a transparent track, a stronger hover tint and no WebKit arrow buttons. Firefox uses its native thin primary-colored scrollbar. The gutter is stable. Styles are scoped to `.nemesis-ai-scroll`; they do not replace other storefront/admin scrollbars.

## Tool details and loading

Tool-operation details start collapsed and can be opened with the existing disclosure button, which exposes `aria-expanded`. The activity header remains available; collapsing details does not discard tool output, hide approval cards or change execution behavior.

The loading card says **“Working on your request”** and **“Putting the details together for you.”** It does not claim a model name, a particular tool stage, a percent complete, or that proposed changes have been saved. Cloud and browser-local providers share the same wording; model details remain in the header.

Primary-colored dots, a gentle icon pulse and an indeterminate accent line provide subtle feedback. Finished responses fade in without a position transform, so animation does not change scroll calculations. All animation respects `prefers-reduced-motion`. Loading uses one polite status announcement; decorative animation is hidden from assistive technology.

## Verification and scope

ESLint, TypeScript and diff checks are static verification. No tests, live model requests or order operations were run, following the standing user instruction. Browser behavior is not represented as runtime-tested. No database migration or backend/provider/token-policy change is required.
