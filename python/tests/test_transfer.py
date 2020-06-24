"""
uuid-1, uuid-3 --> uuid-2
"""
import shutil
import time
from unittest.mock import patch

import numpy as np
import pyarrow as pa
import pyarrow.plasma as plasma
import pytest

import orchest
from orchest import transfer


PLASMA_STORE_CAPACITY = 10000


@pytest.fixture()
def plasma_store(monkeypatch):
    with plasma.start_plasma_store(PLASMA_STORE_CAPACITY) as info:
        store_socket_name, _ = info
        monkeypatch.setattr(orchest.Config, 'STORE_SOCKET_NAME', store_socket_name)
        yield store_socket_name

    uuids = [
        'uuid-1______________',
        'uuid-2______________',
        'uuid-3______________'
    ]

    for step_uuid in uuids:
        shutil.rmtree(f'tests/userdir/.data/{step_uuid}', ignore_errors=True)


class Foo:
    def __init__(self, x):
        self.x = x

    def __eq__(self, other):
        return self.x == other.x


@pytest.mark.parametrize('data_1', [
        [1, 2, 3],
        [Foo(1), Foo(2), Foo(3)],
    ],
    ids=['basic', 'pickle']
)
@pytest.mark.parametrize('test_transfer', [
        {
            'method': transfer.send_disk,
            'kwargs': {}
        },
    ],
    ids=['default']
)
@patch('orchest.transfer.get_step_uuid')
@patch('orchest.Config.STEP_DATA_DIR', 'tests/userdir/.data/{step_uuid}')
def test_disk(mock_get_step_uuid, data_1, test_transfer, plasma_store):
    # Do as if we are uuid-1. Note the trailing underscores. This is to
    # make the plasma.ObjectID the required 20 characters.
    mock_get_step_uuid.return_value = 'uuid-1______________'

    test_transfer['method'](
        data_1,
        pipeline_description_path='tests/userdir/pipeline-basic.json',
        **test_transfer['kwargs']
    )

    # Do as if we are uuid-2
    mock_get_step_uuid.return_value = 'uuid-2______________'
    received_data = transfer.receive('tests/userdir/pipeline-basic.json')

    assert received_data == [data_1]


# TODO: add tests for other kwargs
@pytest.mark.parametrize('data_1', [
        [1, 2, 3],
        [Foo(1), Foo(2), Foo(3)],
    ],
    ids=['basic', 'pickle']
)
@pytest.mark.parametrize('test_transfer', [
        {
            'method': transfer.send_memory,
            'kwargs': {
                'disk_fallback': False,
            }
        }
    ],
    ids=['disk_fallback=False']
)
@patch('orchest.transfer.get_step_uuid')
@patch('orchest.Config.STEP_DATA_DIR', 'tests/userdir/.data/{step_uuid}')
def test_memory(mock_get_step_uuid, data_1, test_transfer, plasma_store):
    test_transfer['kwargs']['store_socket_name'] = plasma_store

    # Do as if we are uuid-1. Note the trailing underscores. This is to
    # make the plasma.ObjectID the required 20 characters.
    mock_get_step_uuid.return_value = 'uuid-1______________'
    test_transfer['method'](
        data_1,
        pipeline_description_path='tests/userdir/pipeline-basic.json',
        **test_transfer['kwargs']
    )

    # Do as if we are uuid-2
    mock_get_step_uuid.return_value = 'uuid-2______________'
    received_data = transfer.receive('tests/userdir/pipeline-basic.json')

    assert received_data == [data_1]


@patch('orchest.transfer.get_step_uuid')
@patch('orchest.Config.STEP_DATA_DIR', 'tests/userdir/.data/{step_uuid}')
def test_memory_out_of_memory(mock_get_step_uuid, plasma_store):
    data_1 = np.random.rand(150, 100)
    data_size = pa.serialize(data_1).total_bytes
    assert data_size > PLASMA_STORE_CAPACITY

    # Do as if we are uuid-1
    mock_get_step_uuid.return_value = 'uuid-1______________'

    with pytest.raises(MemoryError):
        transfer.send_memory(
            data_1,
            disk_fallback=False,
            store_socket_name=plasma_store,
            pipeline_description_path='tests/userdir/pipeline-basic.json'
        )


@patch('orchest.transfer.get_step_uuid')
@patch('orchest.Config.STEP_DATA_DIR', 'tests/userdir/.data/{step_uuid}')
def test_memory_disk_fallback(mock_get_step_uuid, plasma_store):
    # Do as if we are uuid-1
    data_1 = np.random.rand(150, 100)
    data_size = pa.serialize(data_1).total_bytes
    assert data_size > PLASMA_STORE_CAPACITY

    mock_get_step_uuid.return_value = 'uuid-1______________'
    transfer.send_memory(
        data_1,
        disk_fallback=True,
        store_socket_name=plasma_store,
        pipeline_description_path='tests/userdir/pipeline-basic.json'
    )

    # Do as if we are uuid-2
    mock_get_step_uuid.return_value = 'uuid-2______________'
    received_data = transfer.receive('tests/userdir/pipeline-basic.json')

    assert (received_data[0] == data_1).all()


@patch('orchest.transfer.get_step_uuid')
@patch('orchest.Config.STEP_DATA_DIR', 'tests/userdir/.data/{step_uuid}')
def test_memory_pickle_and_disk_fallback(mock_get_step_uuid, plasma_store):
    data_1 = [Foo(i) for i in range(1000)]
    serialized, _ = transfer._serialize_memory(data_1)
    assert serialized.total_bytes > PLASMA_STORE_CAPACITY

    # Do as if we are uuid-1
    mock_get_step_uuid.return_value = 'uuid-1______________'
    transfer.send_memory(
        data_1,
        disk_fallback=True,
        store_socket_name=plasma_store,
        pipeline_description_path='tests/userdir/pipeline-basic.json'
    )

    # Do as if we are uuid-2
    mock_get_step_uuid.return_value = 'uuid-2______________'
    received_data = transfer.receive('tests/userdir/pipeline-basic.json')

    assert received_data == [data_1]


@patch('orchest.transfer.get_step_uuid')
@patch('orchest.Config.STEP_DATA_DIR', 'tests/userdir/.data/{step_uuid}')
def test_resolve_disk_memory(mock_get_step_uuid, plasma_store):
    # Do as if we are uuid-1.
    mock_get_step_uuid.return_value = 'uuid-1______________'

    data_1 = 'data'
    transfer.send_disk(
        data_1,
        pipeline_description_path='tests/userdir/pipeline-basic.json'
    )

    # It is very unlikely you will send through memory and disk in quick
    # succession. In addition, the resolve order has a precision of
    # seconds. Thus we need to ensure that indeed it can be resolved.
    time.sleep(1)

    data_1_new = 'new data'
    transfer.send_memory(
        data_1_new,
        disk_fallback=False,
        store_socket_name=plasma_store,
        pipeline_description_path='tests/userdir/pipeline-basic.json'
    )

    # Do as if we are uuid-2
    mock_get_step_uuid.return_value = 'uuid-2______________'
    received_data = transfer.receive('tests/userdir/pipeline-basic.json')

    assert received_data == [data_1_new]


@patch('orchest.transfer.get_step_uuid')
@patch('orchest.Config.STEP_DATA_DIR', 'tests/userdir/.data/{step_uuid}')
def test_resolve_memory_disk(mock_get_step_uuid, plasma_store):
    # Do as if we are uuid-1.
    mock_get_step_uuid.return_value = 'uuid-1______________'

    data_1 = 'data'
    transfer.send_memory(
        data_1,
        disk_fallback=False,
        store_socket_name=plasma_store,
        pipeline_description_path='tests/userdir/pipeline-basic.json'
    )

    # It is very unlikely you will send through memory and disk in quick
    # succession. In addition, the resolve order has a precision of
    # seconds. Thus we need to ensure that indeed it can be resolved.
    time.sleep(1)

    data_1_new = 'new data'
    transfer.send_disk(
        data_1_new,
        pipeline_description_path='tests/userdir/pipeline-basic.json'
    )

    # Do as if we are uuid-2
    mock_get_step_uuid.return_value = 'uuid-2______________'
    received_data = transfer.receive('tests/userdir/pipeline-basic.json')

    assert received_data == [data_1_new]


@patch('orchest.transfer.get_step_uuid')
@patch('orchest.Config.STEP_DATA_DIR', 'tests/userdir/.data/{step_uuid}')
def test_receive_input_order(mock_get_step_uuid, plasma_store):
    """Test the order of the inputs of the receiving step.

    Note that the order in which the data is send does not determine the
    "receive order", it is the order in which it is defined in the
    pipeline.json (for the "incoming-connections").
    """
    # Do as if we are uuid-3
    data_3 = 'data-3'
    mock_get_step_uuid.return_value = 'uuid-3______________'
    transfer.send_memory(
        data_3,
        store_socket_name=plasma_store,
        pipeline_description_path='tests/userdir/pipeline-order.json'
    )

    # Do as if we are uuid-1
    data_1 = 'data-1'
    mock_get_step_uuid.return_value = 'uuid-1______________'
    transfer.send_memory(
        data_1,
        store_socket_name=plasma_store,
        pipeline_description_path='tests/userdir/pipeline-order.json'
    )

    # Do as if we are uuid-2
    mock_get_step_uuid.return_value = 'uuid-2______________'
    received_data = transfer.receive('tests/userdir/pipeline-order.json')

    assert received_data == [data_1, data_3]


# TODO: multiple pipeline.json files, where it should always work with
#       disk_fallback. With disk_fallback=False it should sometimes
#       throw an error, and sometimes it should fit (because it evicted
#       something else).
@patch('orchest.transfer.get_step_uuid')
@patch('orchest.Config.STEP_DATA_DIR', 'tests/userdir/.data/{step_uuid}')
def test_eviction(mock_get_step_uuid, plasma_store):
    # TODO:
    #   - new pipeline definition
    #   - make one of the output to large for memory

    # Do as if we are uuid-1
    data_1 = 'data-1'
    mock_get_step_uuid.return_value = 'uuid-1______________'
    transfer.send_memory(
        data_1,
        store_socket_name=plasma_store,
        pipeline_description_path='tests/userdir/pipeline-order.json'
    )

    # Do as if we are uuid-3
    data_3 = 'data-3'
    mock_get_step_uuid.return_value = 'uuid-3______________'
    transfer.send_memory(
        data_3,
        store_socket_name=plasma_store,
        pipeline_description_path='tests/userdir/pipeline-order.json'
    )

    # Do as if we are uuid-2
    mock_get_step_uuid.return_value = 'uuid-2______________'
    received_data = transfer.receive('tests/userdir/pipeline-order.json')

    assert False == True
