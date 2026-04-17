import zipfile, json, io, uuid, time
import rmscene.scene_stream as ss
from rmscene.crdt_sequence import CrdtSequence, CrdtSequenceItem
from rmscene.scene_items import ParagraphStyle, Text
from rmscene.tagged_block_common import CrdtId, LwwValue

EXEC_RMDOC = "/app/data/EXEC.rmdoc"
OUT_RMDOC  = "/app/data/EXEC_modified.rmdoc"

BOLD     = ParagraphStyle.BOLD
CHECKBOX = ParagraphStyle.CHECKBOX

with open("/app/data/future_projects.json") as f:
    PROJECTS = json.load(f)


def make_text_block(block_id_n, pos_x, pos_y, width, paragraphs, author=99):
    crdt_items, styles = {}, {}
    n = block_id_n * 1000
    prev_id = CrdtId(0, 0)
    for text, style in paragraphs:
        # format marker item — integer value, device uses this for paragraph style
        fmt_id = CrdtId(author, n); n += 1
        crdt_items[fmt_id] = CrdtSequenceItem(
            item_id=fmt_id, left_id=prev_id, right_id=CrdtId(0, 0),
            deleted_length=0, value=int(style)
        )
        styles[prev_id] = LwwValue(timestamp=fmt_id, value=style)
        # text content item
        txt_id = CrdtId(author, n); n += 1
        crdt_items[txt_id] = CrdtSequenceItem(
            item_id=txt_id, left_id=fmt_id, right_id=CrdtId(0, 0),
            deleted_length=0, value=text + "\n"
        )
        prev_id = txt_id
    seq = CrdtSequence(); seq._items = crdt_items
    return ss.RootTextBlock(
        extra_data=b"",
        block_id=CrdtId(author, block_id_n),
        value=Text(items=seq, styles=styles,
                   pos_x=float(pos_x), pos_y=float(pos_y), width=float(width)),
    )


# 2-column layout — left: RENOS, ORGANIZATION, READING LIST; right: CRAFT
# Estimates: ~100px per bold heading, ~85px per checkbox item
sections = {s["title"]: s for s in PROJECTS["sections"]}

def section_block(block_id_n, pos_x, pos_y, width, section):
    paragraphs = [(section["title"], BOLD)] + [(item, CHECKBOX) for item in section["items"]]
    return make_text_block(block_id_n, pos_x, pos_y, width, paragraphs)

LEFT_X, RIGHT_X, COL_W = -602, 0, 430

projects_blocks = [
    section_block(40, LEFT_X,  200,  COL_W, sections["RENOS"]),
    section_block(41, LEFT_X,  860,  COL_W, sections["ORGANIZATION"]),
    section_block(42, LEFT_X,  1435, COL_W, sections["READING LIST"]),
    section_block(43, RIGHT_X, 200,  COL_W, sections["CRAFT"]),
]

# read EXEC
with zipfile.ZipFile(EXEC_RMDOC) as z:
    uid = [f for f in z.namelist() if f.endswith(".content")][0].replace(".content", "")
    content = json.loads(z.read(f"{uid}.content"))
    pages = content["cPages"]["pages"]
    page0_id = pages[0]["id"]
    page1_id = pages[1]["id"]
    exec_files = {name: z.read(name) for name in z.namelist()}
    with z.open(f"{uid}/{page0_id}.rm") as f:
        blocks_p0 = list(ss.read_blocks(f))
    with z.open(f"{uid}/{page1_id}.rm") as f:
        blocks_p1 = list(ss.read_blocks(f))

from rmscene.scene_items import Group
from uuid import UUID

AUTHOR_UUID = UUID("99000000-0000-0000-0000-000000000000")
ROOT_ID  = CrdtId(0, 1)
AI_ID    = CrdtId(1, 10)   # match existing layer IDs from EXEC
WAI_ID   = CrdtId(1, 11)

heading_block = make_text_block(
    block_id_n=39, pos_x=-602, pos_y=60, width=936,
    paragraphs=[("FUTURE TRIBUTES TO THE ARCHITECT", BOLD)],
)

# rebuild page 1 from scratch with correct block ordering
blocks_p1 = [
    ss.AuthorIdsBlock(author_uuids={99: AUTHOR_UUID}),
    ss.MigrationInfoBlock(migration_id=CrdtId(1, 1), is_device=True),
    ss.PageInfoBlock(loads_count=1, merges_count=0, text_chars_count=0, text_lines_count=0),
    ss.SceneInfo(
        current_layer=LwwValue(timestamp=CrdtId(99, 1), value=AI_ID),
        background_visible=LwwValue(timestamp=CrdtId(0, 0), value=True),
        root_document_visible=LwwValue(timestamp=CrdtId(0, 0), value=True),
        paper_size=(1404, 1872),
    ),
    ss.SceneTreeBlock(tree_id=AI_ID,  node_id=CrdtId(0, 0), is_update=True, parent_id=ROOT_ID),
    ss.SceneTreeBlock(tree_id=WAI_ID, node_id=CrdtId(0, 0), is_update=True, parent_id=ROOT_ID),
    heading_block,
    *projects_blocks,
    ss.TreeNodeBlock(group=Group(node_id=ROOT_ID)),
    ss.TreeNodeBlock(group=Group(node_id=AI_ID,
        label=LwwValue(timestamp=CrdtId(99, 2), value="AI"),
        visible=LwwValue(timestamp=CrdtId(99, 3), value=True))),
    ss.TreeNodeBlock(group=Group(node_id=WAI_ID,
        label=LwwValue(timestamp=CrdtId(99, 4), value="Wai"),
        visible=LwwValue(timestamp=CrdtId(99, 5), value=True))),
]

buf_p0 = io.BytesIO(); ss.write_blocks(buf_p0, blocks_p0)
buf_p1 = io.BytesIO(); ss.write_blocks(buf_p1, blocks_p1)

new_uid = str(uuid.uuid4())
metadata = json.loads(exec_files[f"{uid}.metadata"])
metadata["new"] = True
metadata["visibleName"] = "EXEC (AI)"
metadata["lastModified"] = str(int(time.time() * 1000))

with zipfile.ZipFile(OUT_RMDOC, 'w', zipfile.ZIP_DEFLATED) as z:
    for name, data in exec_files.items():
        new_name = name.replace(uid, new_uid)
        if name == f"{uid}/{page0_id}.rm":
            z.writestr(new_name, buf_p0.getvalue())
        elif name == f"{uid}/{page1_id}.rm":
            z.writestr(new_name, buf_p1.getvalue())
        elif name == f"{uid}.metadata":
            z.writestr(new_name, json.dumps(metadata))
        else:
            z.writestr(new_name, data)

print(f"Wrote {OUT_RMDOC}")
