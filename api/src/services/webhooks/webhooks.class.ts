import { NotImplemented } from "@feathersjs/errors";
import { Params } from "@feathersjs/feathers";
import { Application } from "../../declarations";
import {
  AriesCredentialAttribute,
  AriesCredentialOffer,
} from "../../models/credential-exchange";
import {
  ConnectionState,
  CredExState,
  ServiceAction,
  ServiceType,
  WebhookTopic,
} from "../../models/enums";
import { formatCredentialPreview } from "../../utils/credential-exchange";
import { updateInviteRecord } from "../../utils/issuer-invite";
import { sleep } from "../../utils/sleep";

interface Data {
  state?: CredExState | ConnectionState;
  credential_exchange_id?: string;
  credential_proposal_dict?: any;
  revocation_id?: string;
  revoc_reg_id?: string;
  connection_id?: string;
}

interface ServiceOptions {}

export class Webhooks {
  app: Application;
  options: ServiceOptions;

  constructor(options: ServiceOptions = {}, app: Application) {
    this.options = options;
    this.app = app;
  }

  async create(data: Data, params?: Params): Promise<any> {
    const topic = params?.route?.topic;
    switch (topic) {
      case WebhookTopic.Connections:
        this.handleConnection(data);
        return { result: "Success" };
      case WebhookTopic.IssueCredential:
        this.handleIssueCredential(data);
        return { result: "Success" };
      default:
        return new NotImplemented(`Webhook ${topic} is not supported`);
    }
  }

  private async handleConnection(data: Data): Promise<any> {
    // implement your connection webhook logic here
    if (data.state == ConnectionState.Active) {
      console.log(`Established new connection: ${data.connection_id}`);
      const schema = this.app.get("schemas").get("default");
      const cred_def_id = this.app
        .get("credDefs")
        .get(schema.schema_id) as string;

      // await sleep(5000);

      // let i = 1;
      for (let i = 1; i <= 50; i++) {
        await this.app.service("aries-agent").create({
          service: ServiceType.CredEx,
          action: ServiceAction.Create,
          data: {
            connection_id: data.connection_id,
            comment: `Offering credential ${i}`,
            cred_def_id: cred_def_id,
            credential_preview: formatCredentialPreview([
              {
                name: "cred_num",
                value: `${i}`,
              } as AriesCredentialAttribute,
            ]),
          } as AriesCredentialOffer,
        });
      }
    }
  }

  private async handleIssueCredential(data: Data): Promise<any> {
    switch (data.state) {
      case CredExState.RequestReceived:
        const attributes = data.credential_proposal_dict?.credential_proposal
          ?.attributes as AriesCredentialAttribute[];
        await this.app.service("aries-agent").create({
          service: ServiceType.CredEx,
          action: ServiceAction.Issue,
          data: {
            credential_exchange_id: data.credential_exchange_id,
            attributes: attributes,
          },
        });
        return { result: "Success" };
      case CredExState.Issued:
        console.log(
          `Credential issued for cred_ex_id ${data.credential_exchange_id}`
        );
        updateInviteRecord(
          { credential_exchange_id: data.credential_exchange_id },
          {
            issued: true,
            revoked: data.revocation_id ? false : undefined,
            revocation_id: data.revocation_id,
            revoc_reg_id: data.revoc_reg_id,
          },
          this.app
        );
        // await sleep(2500);
        await this.app.service("aries-agent").create({
          service: ServiceType.CredEx,
          action: ServiceAction.Revoke,
          data: {
            revocation_id: data.revocation_id,
            revoc_reg_id: data.revoc_reg_id,
            publish: (parseInt(data.revocation_id || "1", 10) % 20) === 0 ? true : false
            // publish: true
          },
        });
        return { result: "Success" };
      default:
        console.warn(
          `Received unexpected state ${data.state} for cred_ex_id ${data.credential_exchange_id}`
        );
        return { status: `Unexpected state ${data.state}` };
    }
  }
}
