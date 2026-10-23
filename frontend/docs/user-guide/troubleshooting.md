# Troubleshooting

This chapter lists common problems in Meridian, the message you see and what to do. Some fixes need an administrator of Meridian or of the server it runs on; each section says so.

## What you see when something goes wrong

- A box with a title such as "Could not reach the server.", "You do not have access to this.", "Not found." or "The server could not complete the request.", the server's own explanation where it gave one, and a **Retry** button.
- "The server is busy and did not answer in time. Try again." when the server took too long.
- "This page hit an error" with a **Reference**, **Try again**, **Go home** and **Copy details**. The rest of the screen keeps working.

"You do not have access to this." means your role does not allow the request. Ask an administrator, or use **Request access** where a button offers it.

## You cannot sign in

1. "Email or password is wrong." Check both and try again. The same message appears when your account has been suspended, so if you are sure of your password, ask an administrator to check that you are **Active** on **Users and audit**.
2. "Too many attempts. Wait a minute and try again." Wait one minute.
3. Forgotten password: click **Forgot password?**, enter your email and click **Send link**. The link works for one hour. No email after a few minutes? Check spam, or ask your administrator.
4. "Meridian could not be reached. Check that the server is running." An administrator of the server checks the services with `docker compose ps` in the install directory.
5. An invitation link that is "invalid or has expired": ask your administrator for a new invitation. If it "has already been used", sign in with the password you set.
6. A **Licence needed** page: the licence is invalid or has expired. An administrator renews it in Meridian HQ; then click **Retry**.

## A page shows no data

Pages show the newest finished run unless the address names one with `?run=`. Before any run has finished, pages say so, for example "Nothing has been analysed yet, so there is no score to show." or "Objects appear here once the first run has finished."

1. Open [Runs](/runs) to see whether a run is still going. Home says "Analysis is running" until it finishes, then shows the score.
2. If there is no run at all, connect a system on [Systems](/systems) or load a file on [Import file](/import).
3. If a colleague sees data you do not, your role may be scoped to some systems or modules. Ask an administrator to check your grants.

"Nothing to compare yet" means there is no earlier run to compare with:

- On **Progress**, a comparison needs two finished runs of the same system, or of the same uploaded objects. Run the next extraction and come back. "The trend starts with the second run" on Home means the same.
- On a system's configuration comparison, the configuration has not been loaded. Click **Load configuration**.

## A run failed

1. On [Runs](/runs), click the **Failed runs** figure, or open `/runs?status=failed`.
2. Open the run and choose the **Steps** tab. Each step shows its **Status**, **Duration** and **Error**.
3. Click the failed step to read the whole error.
4. Fix the cause, then click **Re-run analysis** in the run's header. This needs the analyse permission. It re-checks the stored data with the current rules and replaces the findings; the name, baseline and history stay.

"No findings in this run" or "No objects scored" means the run finished without results; **Open steps** shows what ran.

A run that stays running for a long time usually means the background workers have stopped. An administrator of the server checks them with `docker compose ps worker` and `docker compose logs worker`, and restarts them with `docker compose restart worker`.

## An extraction failed or a table could not be read

1. Open the system on [Systems](/systems) and choose the **Runs** tab.
2. In the **Extraction** column, click **Why it failed**. The page names the step that failed and its error, and lists every step. **Export** downloads the step log.
3. Share the error with whoever looks after the SAP connection. It is the message the system returned.

When loading configuration only partly works, the **Health** tab says "Configuration loaded with gaps" and offers **Try again**. Objects it could not read are listed as "Could not read" with the reason. Rules that depend on the missing areas apply by default until they load. Objects listed as "Not available from this system" cannot be read from that kind of system; there is nothing to fix.

"No rows loaded yet" on a system's **Overview** means nothing has been extracted. Click **Extract**.

## A system shows Unreachable or Sign-in refused

A system's connection is **Healthy**, **Degraded**, **Unreachable**, **Sign-in refused** or **Not tested**. Meridian tests every connection every 30 minutes.

1. Open the system and choose the **Health** tab. The **Connection** card states the problem and the system's message, with the **Last health check**.
2. Click **Test connection**. If it fails again the button reads **Test failed, retry**.
3. **Unreachable**: the server could not reach the SAP system. Check with your network or SAP team that the host is up and open to the Meridian server.
4. **Sign-in refused**: the SAP system rejected the user or credentials. Someone who manages systems clicks **Edit** and updates them, then tests again.

## A rule could not be evaluated

The pass rate column on [Rules](/rules) tells you why a rule has no result:

- **Not run yet**: no finished analysis has evaluated it.
- **Not applicable**: the loaded configuration shows the rule does not apply. Hover for the reason.
- On a rule's page, **Applies by default** means no configuration is loaded yet, and **Not available** means the system cannot supply what the rule needs.

For imported files, a standard field with no matching column is skipped by every check that needs it. The import says how many required fields have no column. An administrator maps the column on **Field mapping**.

Comparisons leave out rules that did not run cleanly in both runs, and say how many.

## The score looks capped

A critical finding caps the score: one critical finding caps it at 85, two or more at 70. The cap is fixed. The score shows "Capped at 85" or "Capped at 70", and the ruler draws the measured value beyond it.

1. Open [Objects](/objects) and look for objects with critical findings.
2. Fix or clear the critical findings, then run the analysis again.

Changing dimension weights on **Scoring and alerts** changes the measured score, never the cap.

## A report will not download

1. You need a role that may export. Without it, the reports page says "Export needs the auditor or analyst role."
2. Reports come from a finished run. "No completed run yet" means there is none.
3. A PDF is built on the server first; the button reads **Rendering** until it is ready. If building fails, the server's reason appears at the bottom of the screen.
4. "Nothing to export" means the table you exported from is empty.
5. A report that **Needs** something, such as a record key, cannot download until you supply it.

The **Narrative report (PDF)** appears in a run's **Export** menu only once the language model has written the run's narrative.

If PDFs fail for everyone, an administrator of the server checks `docker compose logs worker` and that object storage is running with `docker compose ps storage`.

## Email or the board pack is not arriving

1. On **Notifications**, open **Manage** on the channel and choose **Send test**.
2. "Test message delivered": the channel works. Check spam and any mail filter.
3. "The channel did not accept the test message": check the address, URL or signing secret. For email, the installation also needs an outgoing email service (Microsoft Graph, an SMTP relay or Resend) set up by the server administrator.

The board pack goes to email channels only, on Monday mornings for weekly and on the 1st for monthly, and covers the latest finished run. With no finished run, nothing is sent. Each channel gets one pack per run in each period. A sent pack adds a "Board pack sent" notice under the bell. The pack carries attachments, so it goes through the SMTP relay or Resend, not Microsoft Graph.

Daily digests, weekly summaries and monthly reports by email or Teams are set on [Scoring and alerts](/rules/scoring).

## The AI summary is missing

When the language model is off or not answering, Meridian shows the four sentences worked out from the findings, or "Summary from the findings (the model is off)". Scores, counts and findings never depend on the model, so everything else works.

1. An administrator opens **Settings**. Under **Health checks**, a failing or warning language model check has a **Fix** link to **AI settings**.
2. On **AI settings**, click **Test connection**. Check the provider, model, endpoint and API key. Bundled Ollama needs a **Request timeout** of 120 seconds.
3. The **AI audit** tab of the **Audit log** lists each call as answered, failed or skipped, with the reason.

## The update failed

The update dialog reports each outcome:

- "Rolled back": the update failed and Meridian went back to the version it was running, which keeps working. Try again later or contact support.
- "The update failed": check the server logs or contact support.
- A message that it is taking longer than expected: click **Check again**. An update usually takes a few minutes.
- "The update did not start", with a reason such as "An update is already in progress" or "Self-update isn't set up for this deployment yet."

From the server, in the install directory, an administrator can go back to the previous version:

```
sudo bash scripts/update.sh --rollback
```

The logs of the application are in `docker compose logs api`. A rollback does not undo database changes. If the update script rolled back after migrating, it prints the command that restores the backup it took before updating.

## How to report a problem

1. Click the help menu (?) in the index bar and choose **Report a problem**.
2. Click **Copy details**. If copying is blocked, select the text and copy it yourself.
3. Paste the details into an email to the support address the dialog shows, with a sentence about what you expected to happen.

The details are three lines: the page address, the run you were viewing (or "none selected") and the Meridian version. Nothing is sent from the dialog itself. If a page showed "This page hit an error", include its **Reference** too.

## Good to know

- An empty page is often a run that has not finished yet, not a fault.
- Most messages come from the server and name the cause. Copy them exactly when you ask for help.

## Related

- [Administration](/docs?page=admin)
- [Runs](/docs?page=runs)
- [Systems](/docs?page=systems)
- [Rules](/docs?page=rules)
- [Reports](/docs?page=reports)
- [Roles](/docs?page=roles)
