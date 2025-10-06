# Pi-hole Lists Sync Action

[![MIT License](https://img.shields.io/badge/License-MIT-green.svg)](https://choosealicense.com/licenses/mit/)
[![GitHub Action](https://img.shields.io/badge/GitHub-Action-blue.svg)](https://github.com/features/actions)

A GitHub Action that syncs Pi-hole blocklists from a specified source to a Pi-hole instance via API. This action helps automate the management of your Pi-hole blocklists by synchronizing them from external sources or local files.

## 🚀 Features

- **Automated Blocklist Sync**: Sync blocklists from external sources to your Pi-hole instance
- **Local DNS Records**: Add local DNS records and CNAMEs to your Pi-hole configuration
- **Self-Signed Certificate Support**: Option to allow self-signed SSL certificates for local Pi-hole instances

### Planned

- Allow list sync

## 📋 Prerequisites

- A running Pi-hole instance with API access enabled
- Pi-hole admin password or app password
- Network access from GitHub/Gitea Actions to your Pi-hole instance (for self-hosted runners or public Pi-hole)

## 🔧 Usage

### Basic Usage

```yaml
name: Sync Pi-hole Blocklists
on:
  push:
    branches:
      - main
  workflow_dispatch:

jobs:
  sync-blocklists:
    runs-on: ubuntu-latest
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Sync Pi-hole blocklists
        uses: kellojo/pihole-lists-sync-action@v1
        with:
          pihole-url: "https://your-pihole.local/api"
          pihole-app-password: ${{ secrets.PIHOLE_PASSWORD }}
          pihole-config-file: "pihole-config.yaml"
```

## ⚙️ Inputs

| Input                     | Description                                              | Required | Default              |
| ------------------------- | -------------------------------------------------------- | -------- | -------------------- |
| `pihole-url`              | The URL of the Pi-hole instance API endpoint             | ✅       | `http://pi.hole/api` |
| `pihole-app-password`     | The admin password or API token for the Pi-hole instance | ✅       | -                    |
| `pihole-config-file`      | The file containing Pi-hole configuration to sync        | ✅       | `pihole-config.yaml` |
| `allow-self-signed-certs` | Allow self-signed SSL certificates (`true`/`false`)      | ❌       | `false`              |

## 📁 Pi-hole Config File Format

Create a `pihole-config.yaml` file in your repository with the following structure:

```yaml
blocklists:
  - https://www.my-list.com/list.txt
  - https://www.my-other-list.com/list.txt

localDnsRecords:
  - domain: my.home
    ip: 192.168.1.10
  - domain: friend.home
    ip: 192.168.1.11

localDnsCnames:
  - domain: alias.my.home
    target: my.home
  - domain: git.my.home
    target: my.home
```

## 🔐 Security Considerations

### Storing Secrets

Always store sensitive information like Pi-hole passwords in GitHub Secrets:

1. Go to your repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `PIHOLE_PASSWORD`
4. Value: Your Pi-hole app password

### Self-Signed Certificates

When using self-signed certificates:

- Only enable `allow-self-signed-certs: true` for trusted, local Pi-hole instances
- Consider using proper SSL certificates for production environments
- Ensure your network is secure when bypassing certificate validation

## 🐛 Troubleshooting

### Common Issues

**401 Unauthorized Error**

```
Error: Authentication failed with status: 401 - Unauthorized
```

- Verify the Pi-hole app password is correct
- Ensure the Pi-hole URL is correct
- Check that the Pi-hole API is enabled and destructive operations are allowed

**SSL Certificate Error**

```
Error: self signed certificate
```

- Set `allow-self-signed-certs: true` for self-signed certificates
- Verify the Pi-hole URL uses the correct protocol (http/https)

## 📝 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

**Note**: This action is not officially affiliated with Pi-hole. It's a community-developed tool to help automate Pi-hole blocklist management.
