import { ITestFramework, TestSessionEventArgs, TestSpecEventArgs, TestFrameworks } from '../../ObjectModel/TestFramework';
import { IEnvironment } from '../../Environment/IEnvironment';
import { MessageSender } from '../MessageSender';
import { TestFrameworkEventHandlers } from '../TestFrameworks/TestFrameworkEventHandlers';
import { BaseExecutionManager } from './BaseExecutionManager';
import { StartDiscoveryPayload } from '../../ObjectModel/Payloads';
import { TestMessageLevel, JSTestSettings } from '../../ObjectModel';

export class DiscoveryManager extends BaseExecutionManager {
    private jsTestSettings: JSTestSettings;
    private testFramework: TestFrameworks;

    constructor(environment: IEnvironment, messageSender: MessageSender, jsTestSettings: JSTestSettings) {
        super(environment, messageSender, jsTestSettings.JavaScriptTestFramework);
        this.jsTestSettings = jsTestSettings;
        this.testFramework = this.jsTestSettings.JavaScriptTestFramework;
        this.testSessionManager.onAllSessionsComplete.subscribe(this.discoveryComplete);
    }

    public discoverTests(request: StartDiscoveryPayload): Promise<void> {
        const sources = request.Sources;
        
        sources.forEach(source => {
            this.testSessionManager.addSession(source, () => {
                const testFrameworkInstance = this.testFrameworkFactory.createTestFramework(this.testFramework);
                this.testFrameworkEventHandlers.Subscribe(testFrameworkInstance);
                testFrameworkInstance.startDiscovery(source);
            },
            (e) => {
                this.sessionError(source, e);
            });
        });

        return this.getCompletetionPromise();
    }

    protected testFrameworkEventHandlers: TestFrameworkEventHandlers = {
        Subscribe: (framework: ITestFramework) => {
            framework.testFrameworkEvents.onTestSessionEnd.subscribe(this.testFrameworkEventHandlers.TestSessionEnd);
            framework.testFrameworkEvents.onTestCaseStart.subscribe(this.testFrameworkEventHandlers.TestCaseStart);
        },

        TestSessionEnd: (sender: object, args: TestSessionEventArgs) => {
            console.log('test session end trigger');
            this.testSessionManager.setSessionComplete(args);
        },

        TestCaseStart: (sender: object, args: TestSpecEventArgs) => {
            console.log('adding test case to cache');
            // this.testDiscoveryCache.addTest(args.TestCase);
            this.messageSender.sendTestCaseFound(args.TestCase);
        }
    };

    private sessionError(source: string, err: Error) {
        if (err) {
            this.messageSender.sendMessage(err.stack ?
                err.stack :
                (err.constructor.name + ': ' + err.message + ' at ' + source), TestMessageLevel.Error);
        }

        const currentSession = this.testSessionManager.getSessionEventArgs(source);

        if (currentSession != null) {
            currentSession.InProgress = false;
            currentSession.EndTime = new Date();
        } else {
            // TODO ??
        }

        this.testSessionManager.setSessionComplete(currentSession);
    }

    private discoveryComplete = () => {
        console.log('discovery complete');

        // const remainingTests = this.testDiscoveryCache.cleanCache();
        // this.messageSender.sendDiscoveryComplete(remainingTests);
        this.messageSender.sendDiscoveryComplete();
        this.onComplete.raise(this, null);
    }
}