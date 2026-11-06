# Code signing policy

Staaash is seeking Windows code signing. The current Windows installers are not
signed through SignPath.

If accepted, free code signing will be provided by [SignPath.io](https://about.signpath.io/), with a certificate by [SignPath Foundation](https://signpath.org/).

## Responsibilities

[itsmeares](https://github.com/itsmeares) maintains the repository and reviews
contributions from other authors. If the application is accepted, itsmeares
will approve each release signing request.

## Desktop app privacy

The desktop app connects to the Staaash server you choose to sign in and sync
your files. The operator of that server controls its data and privacy policy.

The app automatically checks GitHub for updates at startup and every six hours
while it runs. There is no setting to turn these checks off. Windows and Linux
download updates from GitHub; macOS opens the GitHub release page when you choose
to download an update. GitHub receives network requests from your device,
including its IP address. See the [GitHub Privacy Statement](https://docs.github.com/en/site-policy/privacy-policies/github-general-privacy-statement).
