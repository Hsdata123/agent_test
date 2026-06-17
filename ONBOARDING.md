# 新成员上手指南

从零开始:把 `agent_test` 项目拉到本地,并基于 `main` 分支创建自己的开发分支。

> 适用系统:**Windows**
> 仓库地址:https://github.com/Hsdata123/agent_test

---

## 准备工作(由仓库管理员完成)

管理员需要先在 GitHub 上把你加为协作者:

1. 打开 https://github.com/Hsdata123/agent_test/settings/access
2. 点 **Add people** → 输入你的 GitHub 用户名/邮箱
3. 选择 **Write** 权限并发出邀请
4. 你会收到邮件,点击接受邀请后才有 push 权限

---

## 第 1 步:安装 Git

1. 下载安装包:https://git-scm.com/download/win (会自动下载 64 位)
2. 双击 `.exe` 安装,**所有选项一路 Next 默认就行**(默认会同时安装 Git Bash)
3. 装完后,在桌面或任意文件夹的**空白处点右键** → 选 **Open Git Bash here**
   
   - Windows 11 用户可能需要先点"显示更多选项"
4. 验证安装,在 Git Bash 里输入:

   ```bash
   git --version
   ```

   能看到版本号(如 `git version 2.52.0.windows.1`)就说明安装成功。

---

## 第 2 步:配置 Git 用户名和邮箱

⚠️ **请使用你 GitHub 注册时的邮箱**,这样 commit 才会算到你账号上。

```bash
git config --global user.name "你的GitHub用户名"
git config --global user.email "你的GitHub邮箱"
```

验证配置:

```bash
git config --global --list
```

---

## 第 3 步:配置代理(访问 GitHub 必需)

先确认你电脑上代理(vpn)软件(Clash / V2Ray 等)的 **HTTP 端口号**。例如端口是 `7890`,执行:

```bash
git config --global http.proxy http://127.0.0.1:7890
git config --global https.proxy http://127.0.0.1:7890
```

> 📌 端口号在你的代理软件设置里找"HTTP 代理端口",每个人电脑可能不一样。
> 📌 **代理软件必须保持开启**,否则连不上 GitHub。

---

## 第 4 步:选一个工作目录,克隆仓库

在 Git Bash 里,先 `cd` 到你想放代码的目录(例如 `D:\projects`):

```bash
cd /d/projects        # Git Bash 里 Windows 盘符写成 /d/、/e/
git clone https://github.com/Hsdata123/agent_test.git
cd agent_test
```

**首次会弹出 GitHub 登录窗口**(浏览器自动打开),用你的 GitHub 账号登录授权即可,以后就不用再登了。

### 常见错误

| 报错信息 | 原因 | 解决 |
|---------|------|------|
| `Could not connect to server` | 代理没开 / 端口写错 | 回到第 3 步检查 |
| `Permission denied` 或 `403` | 还没被加为协作者 | 联系仓库管理员 |
| `Authentication failed` | GitHub 登录失败 | 重新触发认证,见下方"附录" |

---

## 第 5 步:基于 main 分支创建你自己的分支

```bash
git checkout main                 # 切到主分支(克隆后默认就在 main,保险起见)
git pull                          # 拉取最新代码
git checkout -b 你的名字_dev      # 例如 git checkout -b zhangsan_dev
git push -u origin 你的名字_dev   # 推送到 GitHub,创建远程分支
```

完成 ✅ 现在 GitHub 上多了一个你的分支,可以开始开发。

---

## 日常开发命令速查

### 提交自己的修改

```bash
git status                        # 看当前有什么修改
git add .                         # 暂存所有修改
git commit -m "改了什么"          # 提交到本地
git push                          # 推到 GitHub 自己的分支
```

### 同步 main 的最新代码到自己分支

(团队有人把代码合并到 main 之后,你需要做这一步)

```bash
git checkout main
git pull
git checkout 你的名字_dev
git merge main                    # 把 main 的更新合到自己分支
```

### 切换分支

```bash
git branch                        # 看本地所有分支,带 * 的是当前分支
git checkout main                 # 切到 main
git checkout 你的名字_dev          # 切回自己的分支
```

---

## 启动项目

```bash
npm install                       # 安装依赖(首次)
npm run dev                       # 启动开发服务器
```

具体配置请参考项目根目录的 `README.md` 和 `package.json`。

---

## 把自己的修改合并到 main(走 Pull Request 流程)

不要直接 push 到 main!请通过 Pull Request:

1. 把代码 push 到自己的分支:`git push`
2. 打开 https://github.com/Hsdata123/agent_test
3. 你会看到黄色提示条 "Compare & pull request",点击它
4. 填写标题和说明,选择 **base: main ← compare: 你的分支**
5. 点 **Create pull request**
6. 等待 review 通过后由管理员合并

---

## 附录:常见问题

### Q1:首次 push 没弹出登录窗口怎么办?

打开"控制面板 → 凭据管理器 → Windows 凭据",删除任何 `git:https://github.com` 相关的条目,然后重新 `git push`。

### Q2:代理端口忘了怎么查?

打开你的代理软件(Clash / V2Ray 等)主界面,找"端口设置"或"HTTP Proxy"。Clash 默认是 7890,V2RayN 默认是 10809。

### Q3:换了代理端口要怎么改 Git 配置?

```bash
git config --global http.proxy http://127.0.0.1:新端口
git config --global https.proxy http://127.0.0.1:新端口
```

### Q4:不需要代理了怎么取消?

```bash
git config --global --unset http.proxy
git config --global --unset https.proxy
```

### Q5:不小心改错了文件,想丢弃修改怎么办?

```bash
git checkout -- 文件路径          # 丢弃单个文件的修改
git checkout .                    # 丢弃所有未暂存的修改(谨慎使用)
```


