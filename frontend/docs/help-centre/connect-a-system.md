# Connect a system

A system is one SAP source Meridian reads: an ECC instance, an S/4HANA landscape, a warehouse system, or a cloud product such as SuccessFactors, Ariba or Concur. Nothing else in Meridian works until at least one system is connected, tested and read. This chapter covers what you fill in, what a connection test actually checks, what happens after it passes, and where the secrets go.

## What you name and what you choose

Give the system a name your team already uses, such as "PRD ECC", because that name appears on every run, score and report. Choose the type and the environment: production, quality or development. Types fall into two groups, and the group decides which fields you see.

- RFC types, which cover SAP ECC, S/4HANA on premise and Extended Warehouse Management: host, client, instance number, and a user with its password. The SAP user needs read authorisations only. Meridian never writes to SAP through this connection.
- Cloud types, which cover S/4HANA Cloud, BTP, SuccessFactors, Concur and Ariba: a base URL, an OAuth client ID and client secret, and a token URL where the product asks for one. SuccessFactors also accepts a plain user and password, signed in as the user at your company ID. Ariba asks for its realm and an application key beside the OAuth pair.

Leave a field you do not use empty rather than guessing a value. A guessed instance number or token URL shows up later as a failed job, not as a warning.

## What a connection test checks

Test the connection before you save anything, and again after any change. The test signs in and then makes one short read as a probe, so it answers in seconds rather than waiting on a network stack that will not reply. A pass means both halves worked: the credentials are valid and Meridian can read at least one table through them.

When it fails, the message names the half that broke, and the place to look follows from it.

- A sign-in refusal means the user, password, client ID or client secret is wrong, or the secret has expired. Check the credentials on the connection settings.
- An unreachable message means the server could not get there at all. Check host and instance, then the route from the Meridian server: firewall rules, VPN, or an SAP router.
- A refused authorisation means sign-in worked but SAP will not let that user read one of the tables. Your Basis team grants read access to the tables and the RFC calls, then you test again.
- A timeout means the system answered too slowly to complete the probe. Test again at a quieter hour.
- A missing RFC library means the SAP connector is not installed on the worker. Ask an administrator to install it, or load that system's data from a file instead.

Meridian re-tests every connection every 30 minutes on its own, so a system that was healthy can show a problem before anyone looks. Treat degraded, unreachable and sign-in refused as work to do, not as noise.

## What a good connection unlocks

Two steps follow a passing test, and they do different jobs.

Discovery of objects reads the system's structure: which tables exist, which fields they hold, which objects Meridian can extract at all. Until it runs, Meridian knows what it expects, not what you have. Discovery takes a while on a large landscape and shows its status on the system page; it is safe to leave and come back.

A configuration load reads the customising: which fields are required or suppressed, which values are valid, which parts of the product are switched on. That decides which rules apply. Until it loads, every rule applies by default, so an optional field in your configuration can read as a defect. A load can finish with gaps when some areas could not be read; rules that depend on those areas fall back to applying by default, and the page says how many areas loaded. Retry the gaps once the connection is healthy.

## Where credentials live

Secrets are stored encrypted and scoped to your tenant, so another tenant's request cannot read them, and the page never shows a stored value back to you. They stay inside your own deployment: reading SAP data over this connection sends nothing outside it.

Because a secret belongs to the endpoint it was issued for, treat connection changes and secrets as one decision. Changing the host, the client, the base URL or the token URL means the old secret no longer matches the new target: retype it in the same edit, then test again. Leaving a secret field empty keeps the stored value, which is what you want when only the name or the description changed. Editing one field and keeping an old secret is a common cause of a sudden sign-in refusal.

## Next steps

- Go to [Systems](/systems) to add a system, test it, and start discovery and a configuration load.
- Read what happens to the data next in [Your first analysis run](/runs).
- See which objects Meridian found for that system under [Objects](/objects).
