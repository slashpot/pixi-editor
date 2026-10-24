# Security policy

vite-plugin-pixi-ui-editor runs only on the Vite dev server, but its API rewrites files in your project. A bug that lets someone else reach that API, or write outside `root`, is a security issue.

## Supported versions

Only the latest release gets security fixes.

## Reporting a vulnerability

Please don't open a public issue. Report it privately through GitHub instead: on the repository's **Security** tab, choose **Report a vulnerability** ([direct link](https://github.com/slashpot/pixi-editor/security/advisories/new)).

Include the plugin and Vite versions, your `server` options, and the steps to reproduce. You can expect a first reply within a week.

## Out of scope

- Anyone who can reach a dev server you exposed with `vite --host` can edit your files. That is documented behaviour; see [Security](README.md#security) in the README.
- Setups that turn Vite's own protections off, such as `server.cors: true` or `server.allowedHosts: true`.
