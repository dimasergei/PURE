# Research guide publishing

The published guide index lives at `/learn`. Each guide has one stable URL at `/learn/<slug>`. The build writes static HTML that readers can use with JavaScript disabled.

## Review and publish

1. Keep unpublished drafts in private editorial review. Use a reader question, an original explanation, and primary or official sources that support the claims.
2. Verify each source, check its scope, and record the human review before adding an article to the release manifest.
3. Add approved copy to `data/editorial-guides.json`. Use a unique lowercase hyphenated `slug`, `status: "published"`, a visible `title` and `description`, and a concise `seoTitle` and `seoDescription`. Each section has a `heading` and a `paragraphs` array. Each source has a `title` and its original HTTPS `url`.
4. Enter `publishedOn` or `reviewedOn` only when the dates are known and appropriate for publication. Write dates as `YYYY-MM-DD`. Keep a private review record with the reviewer, source checks, decision and follow-up notes.
5. Run `npm run build` and `node --test tests/editorial-guides.test.cjs`. Check the preview link, headings, source links, keyboard navigation and small-screen rendering before publication.

The renderer excludes entries with `status: "draft"` from guide pages and navigation. A missing or unknown status fails the build. The public renderer escapes article text and validates source URL schemes. Human editorial review still determines whether statements are fit to publish.

## Update and correct

Keep titles and links understandable without company-specific jargon. Separate an observation from what it proves, especially when a report covers a single sample. Use links to original evidence and relevant guides. Review dates and citations when a source changes. Preserve the existing URL for updates and use the corrections policy for reported errors.
