# Validation

After making changes, run `npm run lint` and fix all errors.
Also run `npm run check` for Svelte/TypeScript validation; Oxlint only reads
`<script>` blocks in `.svelte` files, not their templates.

`@shadcn/lint` is registered in `.oxlintrc.json`, but no rules are enabled.
Do not enable design-system rules or change allowed styles unless requested.
See the README's linting section for setup details and rule documentation.
