# Systems

Systems lists every SAP system connected to Meridian: ECC, S/4HANA, SuccessFactors, Concur, Ariba and the others. Your SAP data stays inside your own environment.

## The list

Each row shows the system's health, whether its configuration has been read, and when it was last extracted. The tiles above the table count unhealthy systems and systems whose configuration is missing. Select a tile to filter the table, or a row to open the system.

## One system

The system page has tabs:

- **Overview** shows the score per run and the objects by row count.
- **Objects** is where you choose what to extract.
- **Runs** lists every run read from this system.
- **Health** holds the connection, the configuration load and the schedules.
- **Configuration**, **Custom objects** and **Pilot** cover what the system is set up to do, the customer-defined objects found in it, and how well the rules performed on a labelled sample.

## Extracting

Choose **Extract**, pick the objects, and start. **Extract and analyse** also scores the data when the read finishes. Progress shows in the job tray at the top of every page.

## Configuration load

Loading the configuration tells Meridian which fields and rules apply to this system. Without it, every rule applies by default. With it, a rule for a field your system does not use is marked as not applying instead of failing.

## Schedules

Add a schedule to re-evaluate an object regularly, as a full read or only what changed. A schedule keeps the score current without anyone starting a run.

## If a connection fails

Open the Health tab, run **Test connection**, and read the message. Most failures are a password, a firewall rule or an RFC timeout, and the message names which.
