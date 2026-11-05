from contextlib import ExitStack

import pytest
from fastapi.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from app.main import app, rooms


@pytest.fixture
def client():
    rooms.clear()
    with TestClient(app) as client:
        yield client
    rooms.clear()


def create(client, name="指挥官 A"):
    response = client.post("/api/rooms", json={"name": name})
    assert response.status_code == 201
    return response.json()


def connect(stack, client, identity):
    ws = stack.enter_context(client.websocket_connect("/ws/" + identity["room_code"]))
    ws.send_json(identity)
    return ws


def test_four_players_receive_ready_and_signal_without_private_tokens(client):
    identities = [create(client)]
    code = identities[0]["room_code"]
    for name in ["B", "C", "D"]:
        response = client.post("/api/rooms/" + code + "/join", json={"name": name})
        assert response.status_code == 201
        identities.append(response.json())
    with ExitStack() as stack:
        sockets = []
        for identity in identities:
            sockets.append(connect(stack, client, identity))
            for ws in sockets:
                state = ws.receive_json()
                assert len(state["players"]) == 4
                assert all("token" not in player for player in state["players"])
        sockets[1].send_json({"type": "set_ready", "ready": True})
        for ws in sockets:
            state = ws.receive_json()
            assert state["players"][1]["ready"] is True
        sockets[2].send_json({"type": "test_signal"})
        for ws in sockets:
            assert "C 发送" in ws.receive_json()["event"]
        sockets[0].send_json({"type": "ping"})
        assert sockets[0].receive_json() == {"type": "pong"}


def test_invalid_names_missing_room_and_full_room(client):
    assert client.post("/api/rooms", json={"name": " "}).status_code == 422
    assert client.post("/api/rooms", json={"name": "x" * 21}).status_code == 422
    assert client.post("/api/rooms/ABC123/join", json={"name": "A"}).status_code == 404
    identity = create(client)
    path = "/api/rooms/" + identity["room_code"].lower() + "/join"
    for _ in range(3):
        assert client.post(path, json={"name": "B"}).status_code == 201
    assert client.post(path, json={"name": "E"}).status_code == 409


@pytest.mark.parametrize("bad_id", ["unknown", ["malformed"]])
def test_unauthorized_socket_rejected(client, bad_id):
    identity = create(client)
    with client.websocket_connect("/ws/" + identity["room_code"]) as ws:
        ws.send_json({"player_id": bad_id, "token": "wrong"})
        with pytest.raises(WebSocketDisconnect) as error:
            ws.receive_json()
        assert error.value.code == 4401


def test_wrong_token_cannot_take_existing_seat(client):
    identity = create(client)
    with client.websocket_connect("/ws/" + identity["room_code"]) as ws:
        ws.send_json({**identity, "token": "wrong"})
        with pytest.raises(WebSocketDisconnect) as error:
            ws.receive_json()
        assert error.value.code == 4401


def test_disconnect_removes_last_player_and_revokes_identity(client):
    identity = create(client)
    path = "/ws/" + identity["room_code"]
    with client.websocket_connect(path) as ws:
        ws.send_json(identity)
        ws.receive_json()
        ws.send_json({"type": "set_ready", "ready": True})
        assert ws.receive_json()["players"][0]["ready"]
    with client.websocket_connect(path) as ws:
        ws.send_json(identity)
        with pytest.raises(WebSocketDisconnect) as error:
            ws.receive_json()
        assert error.value.code == 4401
    assert identity["room_code"] not in rooms


def test_disconnect_broadcasts_removal_transfers_host_and_frees_seat(client):
    first = create(client)
    code = first["room_code"]
    second = client.post("/api/rooms/" + code + "/join", json={"name": "B"}).json()
    with client.websocket_connect("/ws/" + code) as b:
        b.send_json(second)
        b.receive_json()
        with client.websocket_connect("/ws/" + code) as a:
            a.send_json(first)
            a.receive_json(); b.receive_json()
        state = b.receive_json()
        assert [p["id"] for p in state["players"]] == [second["player_id"]]
        assert state["players"][0]["host"] and state["players"][0]["connected"]
        for name in ["C", "D", "E"]:
            assert client.post("/api/rooms/" + code + "/join", json={"name": name}).status_code == 201
            b.receive_json()


def test_pagehide_leave_is_authenticated_and_idempotent(client):
    identity = create(client)
    path = "/api/rooms/" + identity["room_code"] + "/leave"
    with client.websocket_connect("/ws/" + identity["room_code"]) as ws:
        ws.send_json(identity)
        ws.receive_json()
        assert client.post(path, json={**identity, "token": "wrong"}).status_code == 403
        assert client.post(path, json=identity).status_code == 204
        with pytest.raises(WebSocketDisconnect):
            ws.receive_json()
        assert client.post(path, json=identity).status_code == 204
    assert identity["room_code"] not in rooms


def test_unconnected_seat_expires(client, monkeypatch):
    import app.main as main
    monkeypatch.setattr(main, "PENDING_JOIN_TIMEOUT", 0)
    identity = create(client)
    # Another request lets the scheduled cleanup acquire the room lock.
    client.get("/health")
    assert identity["room_code"] not in rooms


def test_replacement_connection_does_not_lose_seat(client):
    identity = create(client)
    with ExitStack() as stack:
        old = connect(stack, client, identity)
        old.receive_json()
        new = connect(stack, client, identity)
        assert new.receive_json()["players"][0]["connected"]
        with pytest.raises(WebSocketDisconnect) as error:
            old.receive_json()
        assert error.value.code == 4001
        new.send_json({"type": "set_ready", "ready": True})
        assert new.receive_json()["players"][0]["ready"]


def test_host_transfers_and_departed_token_is_revoked(client):
    first = create(client)
    second = client.post("/api/rooms/" + first["room_code"] + "/join", json={"name": "B"}).json()
    with ExitStack() as stack:
        a = connect(stack, client, first)
        a.receive_json()
        b = connect(stack, client, second)
        a.receive_json(); b.receive_json()
        a.send_json({"type": "leave"})
        state = b.receive_json()
        assert len(state["players"]) == 1 and state["players"][0]["host"]
        with client.websocket_connect("/ws/" + first["room_code"]) as ws:
            ws.send_json(first)
            with pytest.raises(WebSocketDisconnect) as error:
                ws.receive_json()
            assert error.value.code == 4401


def test_cross_origin_websocket_rejected(client):
    identity = create(client)
    with pytest.raises(WebSocketDisconnect) as error:
        with client.websocket_connect("/ws/" + identity["room_code"], headers={"origin": "http://other.example"}):
            pass
    assert error.value.code == 1008


def test_web_page_and_health(client):
    assert client.get("/health").json() == {"status": "ok"}
    assert "舰队集结" in client.get("/").text
    assert client.get("/static/app.js").status_code == 200
