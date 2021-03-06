import { IEnvironment } from '../../Environment/IEnvironment';
import { TestSessionEventArgs } from '../../ObjectModel/TestFramework';
import { IEvent, IEventArgs } from '../../ObjectModel/Common';
import { SessionHash } from '../../Utils/Hashing/SessionHash';
import { EqtTrace } from '../../ObjectModel/EqtTrace';

export interface TestSession {
    Sources: Array<string>;
    TestSessionEventArgs: TestSessionEventArgs;
    Job: () => void;
    ErrorCallback: (err: Error) => void;
    Complete: boolean;
}

export class TestSessionManager {
    private testSessionBucket: Map<string, TestSession>;
    private testSessionIterator: IterableIterator<TestSession>;
    private sessionCompleteCount: number;
    private sessionCount: number;
    public onAllSessionsComplete: IEvent<IEventArgs>;

    public static instance: TestSessionManager;

    protected constructor(environment: IEnvironment) {
        this.sessionCount = 0;
        this.sessionCompleteCount = 0;
        this.onAllSessionsComplete = environment.createEvent();
        this.testSessionBucket = new Map();
        this.testSessionIterator = this.testSessionBucket.values();
    }

    public static INITIALIZE(environment: IEnvironment) {
        if (!TestSessionManager.instance) {
            EqtTrace.info(`TestSessionManager: initializing`);
            TestSessionManager.instance = new TestSessionManager(environment);
        }
    }

    public setSessionComplete(args: TestSessionEventArgs) {
        const testSession = this.testSessionBucket.get(args.SessionId);
        testSession.TestSessionEventArgs = args;

        EqtTrace.info(`TestSessionManager: Session ${args.SessionId} completed.`);

        this.continueNextSession(testSession);
    }

    public addSession(sources: Array<string>, job: () => void, errorCallback: (err: Error) => void) {
        const testSession = <TestSession> {
            Sources: sources,
            TestSessionEventArgs: null,
            Job: job,
            ErrorCallback: errorCallback,
            Complete: false
        };

        const sessionID = SessionHash(sources);

        EqtTrace.info(`TestSessionManager: Added session with sources ${JSON.stringify(sources)}: Session ID: ${sessionID}`);

        if (this.testSessionBucket.has(sessionID)) {
            EqtTrace.warn('TestSessionManager: Test session collision');
        }

        this.testSessionBucket.set(sessionID, testSession);
        this.sessionCount++;

        // TODO should warn if same session id generate
    }

    public executeJobs() {
        this.runSessionInDomain(this.testSessionIterator.next().value);
    }

    public updateSessionEventArgs(args: TestSessionEventArgs) {
        const testSession = this.testSessionBucket.get(args.SessionId);
        testSession.TestSessionEventArgs = args;
    }

    public getSessionEventArgs(sources: Array<string>): TestSessionEventArgs {
        const sessionId = SessionHash(sources);
        return this.testSessionBucket.get(sessionId).TestSessionEventArgs;
    }

    protected runSessionInDomain(testSession: TestSession) {
        // tslint:disable-next-line:no-require-imports
        const domain = require('domain');

        const executionDomain = domain.create();
        try {
            executionDomain.on('error', (err: Error) => {
                EqtTrace.error('TestSessionManager: Error event received from domain', err);
                this.sessionError(testSession, err);
            });
            executionDomain.run(() => {
                EqtTrace.info(`TestSessionManager: Executing session in domain`);
                // this.codecoverage.startCoverage(executeJob);
                testSession.Job();
            });
        } catch (err) {
            EqtTrace.error('TestSessionManager: error running in domain', err);
            this.sessionError(testSession, err);
        }

        return executionDomain;
    }

    private sessionError(testSession: TestSession, err: Error) {
        if (testSession.TestSessionEventArgs != null) {
            testSession.TestSessionEventArgs.InProgress = false;
            testSession.TestSessionEventArgs.EndTime = new Date();
            EqtTrace.error(`TestSessionManager: Session ${testSession.TestSessionEventArgs.SessionId}`, err);
        } else {
            EqtTrace.error(`TestSessionManager: Session with undefined id`, err);
        }

        testSession.ErrorCallback(err);

        this.continueNextSession(testSession);
    }

    private continueNextSession(testSession: TestSession) {
        if (!testSession.Complete) {
            this.sessionCompleteCount++;

            const nextSession = this.testSessionIterator.next();

            if (!nextSession.done) {
                this.runSessionInDomain(nextSession.value);
            }
        }
        testSession.Complete = true;

        // Check for all session completion
        if (this.sessionCount === this.sessionCompleteCount) {
            this.onAllSessionsComplete.raise(this, {});
        }
    }
}