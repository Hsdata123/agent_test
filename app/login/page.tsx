"use client";

import { Button, Card, Checkbox, Form, Input, Typography, message } from "antd";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const router = useRouter();

  async function submit(values: { username: string; password: string }) {
    const response = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(values)
    });
    const payload = await response.json();
    if (!payload.success) {
      message.error(payload.message || "登录失败");
      return;
    }
    message.success("登录成功");
    router.push("/projects");
  }

  return (
    <main className="login-wrap">
      <section className="login-visual">
        <div className="brand" style={{ marginBottom: 28 }}>
          <span className="brand-mark">AI</span>
          <span>电商视觉生成工作台</span>
        </div>
        <h1>批量生成主图与详情页，把机制、白底图和卖点串成一条顺滑流程。</h1>
        <p>Web 测试版 MVP：项目、知识库、机制解析、同名匹配、任务队列和真实图片 API 调用。</p>
      </section>
      <section className="login-panel">
        <Card className="login-card soft-card" bordered={false}>
          <Typography.Title level={3}>账号登录</Typography.Title>
          <Typography.Paragraph type="secondary">默认管理员：admin / admin123</Typography.Paragraph>
          <Form layout="vertical" onFinish={submit} initialValues={{ username: "admin", remember: true }}>
            <Form.Item name="username" label="账号" rules={[{ required: true, message: "请输入账号" }]}>
              <Input size="large" placeholder="请输入账号" />
            </Form.Item>
            <Form.Item name="password" label="密码" rules={[{ required: true, message: "请输入密码" }]}>
              <Input.Password size="large" placeholder="请输入密码" />
            </Form.Item>
            <Form.Item name="remember" valuePropName="checked">
              <Checkbox>记住账号</Checkbox>
            </Form.Item>
            <Button size="large" type="primary" htmlType="submit" block>
              登录
            </Button>
          </Form>
        </Card>
      </section>
    </main>
  );
}
