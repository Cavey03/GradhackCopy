# AWS Amplify Hosting

This repository exports the Expo web frontend as a static single-page
application.

## Build settings

- Install command: `npm ci`
- Amplify build command: `npx expo export --platform web`
- Equivalent package script: `npm run build:web`
- Artifact directory: `dist`
- Build runtime: Node.js 22 on the Amplify Amazon Linux 2023 image
- Required environment variable:
  `EXPO_PUBLIC_API_URL=https://your-api.execute-api.region.amazonaws.com/dev`

`EXPO_PUBLIC_API_URL` is a public API Gateway stage URL, not a secret. Expo
inlines `EXPO_PUBLIC_*` values into the browser bundle, so secrets must never be
stored in this variable.

Expo SDK 57 requires Node.js 22.13 or newer. The build specification selects
Node.js 22 with `nvm use 22`; configure the Amplify branch to use the Amazon
Linux 2023 build image.

The checked-in `amplify.yml` runs the install and export commands, publishes all
files under `dist`, and fails before installing dependencies when
`EXPO_PUBLIC_API_URL` is missing.

## Amplify environment variable

Before starting a build:

1. Open the Amplify app in the AWS console.
2. Go to **Hosting > Environment variables**.
3. Add `EXPO_PUBLIC_API_URL` with the deployed API Gateway stage URL.
4. Prefer a branch override for preview branches if they should use a different
   backend stage.

Do not add Gemini keys, AWS credentials, or any other secret to an
`EXPO_PUBLIC_*` variable.

## SPA rewrite

Add this rule under **Hosting > Rewrites and redirects**:

| Setting | Value |
|---|---|
| Source | `/<*>` |
| Target | `/index.html` |
| Status | `200` |

This allows browser refreshes and future client-side routes to resolve through
the Expo application's `index.html`.

## Branch preview deployment

Do not connect a feature branch to the production domain.

For a direct feature-branch preview:

1. Push the feature branch only after it has been reviewed.
2. In Amplify, open the existing app and choose **Connect branch**.
3. Select the feature branch, for example
   `feature/frontend-demo-readiness`.
4. Add a branch override for `EXPO_PUBLIC_API_URL`.
5. Confirm that the build settings come from the repository's `amplify.yml`.
6. Enable password protection if the preview contains unreleased work.
7. Deploy the branch to its Amplify-generated preview URL.
8. Test login, live-data indicators, activity history, VO2 forecast, check-in,
   what-if behavior, browser refreshes, and CORS before considering production.

For pull-request previews:

1. Open **Hosting > Previews** in the Amplify console.
2. Enable pull-request previews for the intended base branch.
3. Open a pull request from the feature branch.
4. Use the unique Amplify preview URL created for that pull request.

Neither preview option requires merging the feature branch into the production
branch.
