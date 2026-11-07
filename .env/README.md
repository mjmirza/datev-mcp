# Environment Variables

| Variable | Required | Environments | Format | Description |
|---|---|---|---|---|
| DATEV_CLIENT_ID | Yes | all | string | Client ID of your DATEV portal app |
| DATEV_CLIENT_SECRET | Yes | all | string | Client secret of your DATEV portal app |
| DATEV_ENV | No | all | `sandbox` or `production` | Which DATEV servers to call. Default `sandbox` |
| DATEV_REDIRECT_URI | No | all | URL | Redirect URL registered on the app. Default `http://localhost` |

## Setup

1. Copy `.env.example` to `.env.local`
2. Fill in your values
3. Never commit `.env.local`
