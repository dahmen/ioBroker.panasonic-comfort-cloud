const proxyquire = require('proxyquire');
const sinon = require('sinon');
const { expect } = require('chai');

proxyquire.noCallThru();

// js-controller rejects object IDs matching this pattern (packages/common-db tools.ts).
// "/" and "#" are allowed by the controller, but this adapter must not put a GUID into an ID.
const FORBIDDEN_CHARS = /[^._\-/ :!#$%&()+=@^{}|~\p{Ll}\p{Lu}\p{Nd}]+/gu;

const SPECIAL_GUID = 'CS-A73C7247/20230509/M100007#';
const PLAIN_GUID = 'C291443587';
const PLUS_GUID = 'CS-Z25XKEW+4444';

const devices = [
    { guid: PLAIN_GUID, name: 'Schlafzimmer' },
    { guid: PLUS_GUID, name: 'Büro' },
    { guid: SPECIAL_GUID, name: 'Kleineszimmer' },
];

const adapterMock = {
    on: sinon.stub(),
    setState: sinon.stub(),
    setStateAsync: sinon.stub().resolves(),
    setStateChangedAsync: sinon.stub().resolves(),
    getStateAsync: sinon.stub().callsFake(id => {
        const device = devices.find(d => `${d.name}.guid` === id);
        return Promise.resolve(device ? { val: device.guid, ack: true } : null);
    }),
    setObjectNotExistsAsync: sinon.stub().resolves(),
    getObjectAsync: sinon.stub().resolves({ common: { write: true } }),
    subscribeStates: sinon.stub(),
    setTimeout: sinon.stub().returns(1),
    clearTimeout: sinon.stub(),
    updateConfig: sinon.stub().resolves(),
    log: {
        info: sinon.stub(),
        debug: sinon.stub(),
        error: sinon.stub(),
        warn: sinon.stub(),
    },
    config: {
        username: 'testuser',
        password: 'testpassword',
        automaticRefreshEnabled: false,
        historyEnabled: true,
        useAppVersionFromAppStore: false,
        appVersionFromAppStore: '0.0.0',
    },
};

class AdapterClassMock {
    constructor() {
        Object.assign(this, adapterMock);
    }
}

class ComfortCloudClientMock {
    constructor() {}
    login() {
        return Promise.resolve();
    }
    dispose() {}
    getGroups() {
        return Promise.resolve([{ id: 1, name: 'Group1', devices }]);
    }
    getDevice(guid, name) {
        return Promise.resolve({
            guid,
            name,
            operate: 1,
            temperatureSet: 22,
        });
    }
    getDeviceHistoryData() {
        return Promise.resolve({ historyDataList: [] });
    }
    setParameters() {
        return Promise.resolve({});
    }
}

const getDeviceSpy = sinon.spy(ComfortCloudClientMock.prototype, 'getDevice');
const historySpy = sinon.spy(ComfortCloudClientMock.prototype, 'getDeviceHistoryData');
const setParametersSpy = sinon.spy(ComfortCloudClientMock.prototype, 'setParameters');

describe('device GUID with / and # (#90)', () => {
    let onReady;
    let onStateChange;

    before(() => {
        const mainConstructor = proxyquire('../../build/main.js', {
            '@iobroker/adapter-core': {
                Adapter: AdapterClassMock,
            },
            'panasonic-comfort-cloud-client': {
                ...require('panasonic-comfort-cloud-client'),
                ComfortCloudClient: ComfortCloudClientMock,
            },
            './lib/app-version': {
                ...require('../../build/lib/app-version.js'),
                getAppStoreVersion: () => Promise.resolve('0.0.0'),
                getPlayStoreVersion: () => Promise.resolve(undefined),
            },
        });

        adapterMock.on.reset();
        mainConstructor();

        onReady = adapterMock.on.getCalls().find(call => call.args[0] === 'ready').args[1];
        onStateChange = adapterMock.on.getCalls().find(call => call.args[0] === 'stateChange').args[1];
    });

    beforeEach(async () => {
        getDeviceSpy.resetHistory();
        historySpy.resetHistory();
        setParametersSpy.resetHistory();
        adapterMock.setObjectNotExistsAsync.resetHistory();
        adapterMock.setStateChangedAsync.resetHistory();
        await onReady();
    });

    function objectIds() {
        return adapterMock.setObjectNotExistsAsync.getCalls().map(call => call.args[0]);
    }

    it('creates valid objects for the special GUID and keeps existing device ids', () => {
        const ids = objectIds();

        expect(ids).to.include('Schlafzimmer');
        expect(ids).to.include('Schlafzimmer.guid');
        expect(ids).to.include('Büro');
        expect(ids).to.include('Büro.guid');
        expect(ids).to.include('Kleineszimmer');
        expect(ids).to.include('Kleineszimmer.guid');
        expect(ids).to.include('Kleineszimmer.operate');
        expect(ids).to.include('Kleineszimmer.history');
        expect(ids).to.include('Kleineszimmer.history.day.00');

        const guidState = adapterMock.setObjectNotExistsAsync
            .getCalls()
            .find(call => call.args[0] === 'Kleineszimmer.guid');
        expect(guidState.args[1].common.def).to.equal(SPECIAL_GUID);

        const plainGuidState = adapterMock.setObjectNotExistsAsync
            .getCalls()
            .find(call => call.args[0] === 'Schlafzimmer.guid');
        expect(plainGuidState.args[1].common.def).to.equal(PLAIN_GUID);

        for (const id of ids) {
            FORBIDDEN_CHARS.lastIndex = 0;
            expect(FORBIDDEN_CHARS.test(id), `invalid object id ${id}`).to.equal(false);
            expect(id, id).to.not.include(SPECIAL_GUID);
            expect(id, id).to.not.include('%2F');
            expect(id, id).to.not.include('%23');
        }
    });

    it('passes the original GUID to getDevice and history, not a URL-encoded one', () => {
        const readGuids = getDeviceSpy.getCalls().map(call => call.args[0]);
        expect(readGuids).to.include(SPECIAL_GUID);
        expect(readGuids).to.include(PLAIN_GUID);
        expect(readGuids).to.include(PLUS_GUID);
        for (const guid of readGuids) {
            expect(guid).to.not.include('%');
        }
        expect(getDeviceSpy.calledWith(SPECIAL_GUID, 'Kleineszimmer')).to.equal(true);
        expect(getDeviceSpy.calledWith(PLAIN_GUID, 'Schlafzimmer')).to.equal(true);
        expect(getDeviceSpy.calledWith(PLUS_GUID, 'Büro')).to.equal(true);

        const historyGuids = historySpy.getCalls().map(call => call.args[0]);
        expect(historyGuids).to.include(SPECIAL_GUID);
        expect(historyGuids).to.include(PLAIN_GUID);
        for (const guid of historyGuids) {
            expect(guid).to.not.match(/%2F|%23/);
        }
    });

    it('sends the original GUID when controlling the device', async () => {
        setParametersSpy.resetHistory();
        getDeviceSpy.resetHistory();

        await onStateChange('panasonic-comfort-cloud.0.Kleineszimmer.temperatureSet', {
            val: 23,
            ack: false,
        });

        expect(setParametersSpy.calledOnce).to.equal(true);
        expect(setParametersSpy.firstCall.args[0]).to.equal(SPECIAL_GUID);
        expect(setParametersSpy.firstCall.args[1]).to.deep.equal({ temperatureSet: 23 });
        expect(getDeviceSpy.calledWith(SPECIAL_GUID, 'Kleineszimmer')).to.equal(true);

        setParametersSpy.resetHistory();
        await onStateChange('panasonic-comfort-cloud.0.Schlafzimmer.operate', {
            val: 1,
            ack: false,
        });
        expect(setParametersSpy.firstCall.args[0]).to.equal(PLAIN_GUID);
        expect(setParametersSpy.firstCall.args[1]).to.deep.equal({ operate: 1 });
    });
});
