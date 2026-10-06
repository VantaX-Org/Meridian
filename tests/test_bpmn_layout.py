"""BPMNDI layout: grid ranks, designer positions, back-edges, determinism."""

from api.services.bpmn_layout import COL, ROW, X0, Y0, layout_diagram


def test_straight_line_ranks_and_two_point_edges():
    nodes = [("S", "event"), ("T", "task"), ("E", "event")]
    lay = layout_diagram(nodes, [("1", "S", "T"), ("2", "T", "E")])
    assert lay.shapes["S"].x == X0 + (COL - 36) // 2 and lay.shapes["T"].x == X0 + COL + (COL - 100) // 2
    assert lay.shapes["T"].x < lay.shapes["E"].x
    assert [len(lay.edges[f]) for f in ("1", "2")] == [2, 2]  # same centre line
    assert lay.shapes["S"].cy == lay.shapes["T"].cy == Y0 + ROW // 2


def test_back_edge_has_four_waypoints_under_both_shapes():
    nodes = [("S", "event"), ("A", "task"), ("G", "gateway"), ("E", "event")]
    flows = [("1", "S", "A"), ("2", "A", "G"), ("3", "G", "E"), ("4", "G", "A")]  # G -> A loops back
    lay = layout_diagram(nodes, flows, flow_labels={"4": "no"})
    pts = lay.edges["4"]
    assert len(pts) == 4
    g, a = lay.shapes["G"], lay.shapes["A"]
    assert pts[0] == (g.cx, g.y + g.h) and pts[-1] == (a.cx, a.y + a.h)
    assert pts[1][1] == pts[2][1] > max(g.y + g.h, a.y + a.h)
    assert "4" in lay.edge_labels and lay.shapes["E"].x > g.x  # loop did not push E back


def test_branch_goes_to_next_row_with_elbow():
    nodes = [("S", "event"), ("G", "gateway"), ("A", "task"), ("B", "task")]
    lay = layout_diagram(nodes, [("1", "S", "G"), ("2", "G", "A"), ("3", "G", "B")])
    assert lay.shapes["A"].y != lay.shapes["B"].y and lay.shapes["A"].x == lay.shapes["B"].x
    assert any(len(lay.edges[f]) == 4 for f in ("2", "3"))


def test_designer_positions_shifted_to_origin_when_complete():
    nodes = [("S", "event"), ("T", "task")]
    lay = layout_diagram(nodes, [("1", "S", "T")], positions={"S": (500, 300), "T": (700, 340)})
    assert (lay.shapes["S"].x, lay.shapes["S"].y) == (X0, Y0)
    assert (lay.shapes["T"].x, lay.shapes["T"].y) == (X0 + 200, Y0 + 40)
    partial = layout_diagram(nodes, [("1", "S", "T")], positions={"S": (500, 300)})
    assert partial.shapes["S"].x == X0 + (COL - 36) // 2  # incomplete -> auto layout


def test_deterministic_and_cycle_safe():
    nodes = [("S", "event"), ("A", "task"), ("B", "task")]
    flows = [("1", "S", "A"), ("2", "A", "B"), ("3", "B", "A")]
    assert layout_diagram(nodes, flows) == layout_diagram(nodes, flows)
