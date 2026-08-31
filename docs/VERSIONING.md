# Version Rules

## Resource Identity

`contentId` is the immutable identity of a platform resource. A title, edition, or filename is not a unique identifier.

## Human-Readable Distinction

Resources sharing the same stage, subject, grade, volume, edition, and title are presented as a group. Each resource remains selectable and displays:

- resource year
- file size
- online time
- update time
- short content ID

The application never treats these resources as duplicates solely because their titles match.

## Filename Policy

New files use normalized catalog fields and resource year:

```text
{stage}_{subject}_{grade}_{volume}_{edition}_[{resourceYear}]_[{shortContentId}].pdf
```

The short ID remains in the filename because a resource year can be absent or reused. Existing files are never renamed automatically.
