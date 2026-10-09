"""Owner recovery: forget a voter's key so they can re-seal with a new passphrase.

There is no in-app recovery by design -- a forgotten passphrase is a forgotten
key. Run on the server, inside the container (the poll files are written by
it, as root):

    sudo docker compose exec api python -m noodle.reset <slug> "<name>"

The voter keeps their slots and their dot column; their NEXT signed
submission binds whatever key it is signed with.

Plain polls only. An END-TO-END poll (noodle/e2e.py) holds no names, so there
is nothing here to look one up by: there the HOST removes the forgotten seat
and the voter commits again under a new passphrase.
"""
import sys

from noodle import e2e, store, votes


def main(argv: list[str]) -> int:
    if len(argv) != 2:
        print(__doc__.strip())
        return 2
    slug, name = argv
    if not store.valid_slug(slug):
        print(f"not a poll slug: {slug!r}")
        return 1
    if e2e.is_e2e(slug):
        print("end-to-end poll: the server holds no names. The host removes the old seat on the "
              "poll page; the voter then commits again with a new passphrase.")
        return 1
    try:
        done = votes.reset_voter(slug, name)
    except KeyError:
        print(f"no such poll: {slug}")
        return 1
    except ValueError as e:
        print(f"bad name: {e}")
        return 1
    print(f"reset {name!r} in {slug}" if done else f"no voter named {name!r} in {slug}")
    return 0 if done else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
