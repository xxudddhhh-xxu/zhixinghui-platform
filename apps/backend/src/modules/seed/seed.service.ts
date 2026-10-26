import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as bcrypt from 'bcryptjs';
import { User } from '../users/entities/user.entity';
import { Team } from '../teams/entities/team.entity';
import { TeamMember } from '../teams/entities/team-member.entity';
import { Document } from '../documents/entities/document.entity';
import { Assistant } from '../assistants/entities/assistant.entity';
import { KnowledgeBase } from '../knowledge/entities/knowledge-base.entity';

/**
 * 启动播种: 仅当用户表为空时执行一次。
 * 演示账号 —— admin/admin123(平台管理员), alice/Aa123456(研发团队 owner),
 * bob/Bb123456(研发团队 viewer + 产品团队 owner)
 */
@Injectable()
export class SeedService implements OnModuleInit {
  private readonly logger = new Logger(SeedService.name);

  constructor(
    @InjectRepository(User) private userRepo: Repository<User>,
    @InjectRepository(Team) private teamRepo: Repository<Team>,
    @InjectRepository(TeamMember) private memberRepo: Repository<TeamMember>,
    @InjectRepository(Document) private docRepo: Repository<Document>,
    @InjectRepository(Assistant) private assistantRepo: Repository<Assistant>,
    @InjectRepository(KnowledgeBase) private kbRepo: Repository<KnowledgeBase>,
  ) {}

  async onModuleInit() {
    if (process.env.SEED_ON_BOOT === 'false') return;
    const count = await this.userRepo.count();
    if (count > 0) {
      this.logger.log('检测到已有数据,跳过播种');
      return;
    }
    await this.seed();
  }

  private async seed() {
    const hash = (p: string) => bcrypt.hashSync(p, 10);

    const admin = await this.userRepo.save(
      this.userRepo.create({
        username: 'admin',
        password: hash('admin123'),
        nickname: '平台管理员',
        email: 'admin@zhixinghui.com',
        globalRole: 'admin',
      }),
    );
    const alice = await this.userRepo.save(
      this.userRepo.create({
        username: 'alice',
        password: hash('Aa123456'),
        nickname: '王艾丽',
        email: 'alice@zhixinghui.com',
      }),
    );
    const bob = await this.userRepo.save(
      this.userRepo.create({
        username: 'bob',
        password: hash('Bb123456'),
        nickname: '李博',
        email: 'bob@zhixinghui.com',
      }),
    );

    // ===== 团队与成员(两级角色权限模型) =====
    const rdTeam = await this.teamRepo.save(
      this.teamRepo.create({
        name: '研发团队',
        description: '产品研发中心,管理技术规范与接口文档',
        ownerId: alice.id,
      }),
    );
    const pdTeam = await this.teamRepo.save(
      this.teamRepo.create({
        name: '产品团队',
        description: '产品运营中心,管理业务手册与合同模板',
        ownerId: bob.id,
      }),
    );
    await this.memberRepo.save([
      this.memberRepo.create({ teamId: rdTeam.id, userId: alice.id, role: 'owner' }),
      this.memberRepo.create({ teamId: rdTeam.id, userId: bob.id, role: 'viewer' }),
      this.memberRepo.create({ teamId: pdTeam.id, userId: bob.id, role: 'owner' }),
      this.memberRepo.create({ teamId: pdTeam.id, userId: alice.id, role: 'editor' }),
    ]);

    // ===== 研发团队文档树 =====
    const rdRoot = await this.doc(
      rdTeam.id,
      null,
      '技术文档中心',
      'folder',
      alice.id,
    );
    const apiSpec = await this.doc(
      rdTeam.id,
      rdRoot.id,
      'API 接口规范',
      'doc',
      alice.id,
      API_SPEC_CONTENT,
      true,
    );
    await this.doc(rdTeam.id, rdRoot.id, '代码发布流程', 'doc', alice.id, DEPLOY_CONTENT);
    const archFolder = await this.doc(rdTeam.id, rdRoot.id, '架构设计', 'folder', alice.id);
    await this.doc(
      rdTeam.id,
      archFolder.id,
      '微服务拆分方案',
      'doc',
      alice.id,
      ARCH_CONTENT,
    );

    // ===== 产品团队文档树 =====
    const pdRoot = await this.doc(pdTeam.id, null, '业务资料库', 'folder', bob.id);
    await this.doc(pdTeam.id, pdRoot.id, '销售合同模板', 'doc', bob.id, CONTRACT_CONTENT, true);
    await this.doc(pdTeam.id, pdRoot.id, '员工差旅报销制度', 'doc', bob.id, TRAVEL_CONTENT);
    await this.doc(pdTeam.id, pdRoot.id, '客服话术手册', 'doc', bob.id, FAQ_CONTENT);

    // ===== 知识库 =====
    const kb1 = await this.kbRepo.save(
      this.kbRepo.create({
        teamId: rdTeam.id,
        name: '研发知识库',
        description: '技术规范、发布流程、架构文档',
        ownerId: alice.id,
      }),
    );
    await this.kbRepo.save(
      this.kbRepo.create({
        teamId: pdTeam.id,
        name: '业务知识库',
        description: '合同模板、规章制度、客服话术',
        ownerId: bob.id,
      }),
    );

    // ===== 预置智能助手 =====
    await this.assistantRepo.save([
      this.assistantRepo.create({
        userId: admin.id,
        name: '智能客服小惠',
        role: '企业内部智能客服',
        personality: '热情耐心、表达亲切、条理清晰,善用分点说明',
        allowedTopics: '账号权限、合同模板、差旅报销、产品使用问题、API 接口规范',
        deniedTopics: '薪酬机密、法律纠纷裁决、医疗与投资建议',
        retrievalFirst: true,
        kbIds: [kb1.id],
        greeting: '您好,我是智能客服小惠,很高兴为您服务!请问有什么可以帮您?',
        defaultModelId: process.env.GLM_MODEL_ID || 'glm-5.3',
      }),
      this.assistantRepo.create({
        userId: admin.id,
        name: '法务顾问',
        role: '合同与合规方向的企业法务顾问',
        personality: '严谨专业、措辞规范,引用条款时注明出处',
        allowedTopics: '合同条款解读、合规审查要点、知识产权基础问题',
        deniedTopics: '具体案件诉讼策略、对外披露的法律意见',
        retrievalFirst: true,
        kbIds: [],
        greeting: '您好,我是法务顾问,可为您解读合同模板与合规要点。',
        defaultModelId: process.env.JPT_MODEL_ID || 'gpt-5.6-sol',
      }),
    ]);

    this.logger.log('✅ 演示数据播种完成: 3 用户 / 2 团队 / 7 文档 / 2 知识库 / 2 助手');
    this.logger.log('   演示账号: admin/admin123 · alice/Aa123456 · bob/Bb123456');
  }

  private async doc(
    teamId: string,
    parentId: string | null,
    title: string,
    docType: 'folder' | 'doc',
    userId: string,
    content = '',
    isPublic = false,
  ) {
    return this.docRepo.save(
      this.docRepo.create({ teamId, parentId, title, docType, content, isPublic, updatedBy: userId }),
    );
  }
}

const API_SPEC_CONTENT = `# API 接口规范

## 1. 基本约定
- 所有接口以 \`/api\` 为前缀,返回统一信封结构 \`{ code, message, data }\`,code=0 表示成功。
- 认证方式: Bearer Token(JWT),有效期 12 小时,过期返回 401。
- 时间格式统一为 ISO 8601,时区为东八区。

## 2. 分页约定
列表接口统一使用 \`page\` 与 \`pageSize\` 查询参数,默认 pageSize=20,最大 100。
返回结构为 \`{ items, total, page, pageSize }\`。

## 3. 错误码
| 错误码 | 含义 |
| --- | --- |
| 4010 | 未登录或 Token 失效 |
| 4030 | 无权限(跨团队资源隔离) |
| 4090 | 并发编辑冲突 |
| 4290 | 触发限流 |
| 5000 | 服务器内部错误 |

## 4. 流式接口
智能问答使用 POST /api/chat/stream,响应为 SSE 事件流:
meta(会话元信息)→ sources(检索命中来源)→ delta(增量正文)→ tool_start/tool_result(工具调用)→ done(结束)。

## 5. 安全要求
- 敏感操作全部落审计日志(audit_logs 表)。
- 接口默认限流 120 次/分钟,登录接口 10 次/分钟/IP。`;

const DEPLOY_CONTENT = `# 代码发布流程

## 一、发布窗口
每周二、周四 14:00-17:00 为常规发布窗口,紧急修复不受此限制,但需技术负责人审批。

## 二、发布步骤
1. 开发完成自测,提交 Merge Request 并指定至少一名 Codereviewer;
2. CI 流水线通过(单测覆盖率不低于 70%,静态检查零严重问题);
3. 合并主干后自动构建镜像,先发布预发环境验证 30 分钟;
4. 预发验证通过后灰度 10% 流量观察 15 分钟,指标正常再全量;
5. 发布完成后在群里同步《发布记录》:版本号、变更点、回滚方案。

## 三、回滚规范
全量发布后 30 分钟内出现 P0/P1 故障,直接执行回滚,事后补复盘;
超过 30 分钟需值班负责人决策。回滚目标版本必须是最近一次稳定版本。

## 四、禁止事项
- 禁止跳过预发直接生产发布;
- 禁止在周五 18:00 后发起常规发布;
- 禁止同一窗口同时发布两个存在依赖的服务。`;

const ARCH_CONTENT = `# 微服务拆分方案

## 现状与目标
单体应用随业务膨胀,构建时长超过 25 分钟,发布互相阻塞。目标:按业务域拆分为可独立部署的微服务,构建时长降至 5 分钟内。

## 拆分原则
1. 按领域驱动设计的限界上下文拆分:用户域、文档域、知识库域、会话域;
2. 数据库随服务走,跨域访问只允许走 API 或事件,禁止跨库 JOIN;
3. 先绞杀式迁移:网关层逐步路由,旧单体保留至流量清零。

## 技术选型
- 网关: Kong;服务框架: NestJS;前端: Next.js;
- 消息: Kafka(领域事件);检索: Qdrant 向量库 + BM25;
- 可观测: OpenTelemetry 全链路追踪,Prometheus + Grafana 监控。

## 里程碑
- M1(4 周): 用户域与会话域拆出,双写灰度;
- M2(6 周): 文档域与知识库域拆出,检索链路下沉 Python 服务;
- M3(2 周): 旧单体下线,全链路压测验收。`;

const CONTRACT_CONTENT = `# 销售合同模板(标准版 V3.2)

## 第一条 合同主体
买方(甲方):____________ 统一社会信用代码:____________
卖方(乙方):____________ 统一社会信用代码:____________

## 第二条 标的与价款
甲方向乙方购买产品及服务清单见附件一,合同总价(含税)人民币(大写)____________ 元,税率 13%。

## 第三条 付款方式
1. 合同签订后 5 个工作日内,甲方支付预付款 30%;
2. 产品交付验收合格后 10 个工作日内支付 60%;
3. 剩余 10% 作为质保金,质保期满(12 个月)无质量问题后 15 个工作日内付清。
4. 逾期付款按日万分之五支付违约金,累计不超过合同总额的 5%。

## 第四条 交付与验收
交付时间:收到预付款后 20 个工作日内。甲方应在交付后 7 个工作日内完成验收,逾期未提出书面异议视为验收通过。

## 第五条 保密条款
双方对在合作中知悉的商业秘密负有保密义务,保密期限至合同终止后 3 年,违约方赔偿守约方实际损失。

## 第六条 争议解决
因本合同引起的争议,双方应先友好协商;协商不成的,提交乙方所在地有管辖权的人民法院诉讼解决。

## 第七条 生效
本合同一式肆份,双方各执贰份,自双方盖章之日起生效。`;

const TRAVEL_CONTENT = `# 员工差旅报销制度

## 一、适用范围
本制度适用于全体正式员工及实习生因公出差产生的交通、住宿、补贴等费用报销。

## 二、标准(单位: 元/天)
| 职级 | 一线城市住宿 | 其他城市住宿 | 餐补 | 市内交通 |
| --- | --- | --- | --- | --- |
| P5 及以下 | 450 | 350 | 100 | 实报 |
| P6-P7 | 600 | 450 | 120 | 实报 |
| P8 及以上 | 800 | 600 | 150 | 实报 |

## 三、报销流程
1. 出差前在 OA 提交出差申请,注明事由、行程、预算;
2. 返程后 15 个自然日内提交报销单,附行程单、发票原件;
3. 直属上级审批 → 财务复核 → 出纳付款,预计 10 个工作日到账。

## 四、重要说明
- 机票需通过公司协议平台预订,自行购买原则上不予报销;
- 超标准 20% 以内且事前审批的据实报销,未经审批的超标部分自理;
- 发票抬头必须为公司全称,增值税专用发票需在开票之日起 30 日内提交。`;

const FAQ_CONTENT = `# 客服话术手册

## 开场
"您好,这里是智星惠客户服务,工号____很高兴为您服务,请问有什么可以帮您?"

## 高频问题标准应答

### 1. 忘记密码怎么办?
"您可以在登录页点击【忘记密码】,通过绑定手机号或邮箱验证后重置密码。若手机号已停用,请联系管理员重置。"

### 2. 如何申请退款?
"订单签收后 7 天内支持无理由退货,请您在【我的订单】中选择对应订单点击【申请售后】,1-3 个工作日内会有专员跟进审核。"

### 3. 发票多久能开好?
"电子发票一般 24 小时内开具并发送至您的邮箱;纸质发票 7 个工作日内寄出。开票信息可在下单时或订单详情中修改。"

### 4. 产品报障流程?
"请您提供问题截图、账号与发生时间,我们将在 2 小时内响应;P1 级故障(无法登录/数据丢失)会升级至值班工程师 30 分钟内处理。"

## 结束语
"请问还有其他可以帮您的吗?感谢您的来电/留言,祝您生活愉快,再见!"

## 服务红线
- 禁止承诺任何未书面确认的赔偿金额;
- 禁止向客户透露内部系统地址与任何他人数据;
- 客户情绪激动时先安抚致歉,两次仍无法平复则转接主管。`;
