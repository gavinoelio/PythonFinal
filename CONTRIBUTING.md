# 团队协作

仓库管理员在 GitHub 仓库的 Settings → Collaborators 中邀请队友；私有仓库的队友需要接受邀请才能克隆和推送。

第一次开发：

```sh
git clone https://github.com/gavinoelio/PythonFinal.git
cd PythonFinal
git switch -c feature/your-task
```

按 README 创建自己的虚拟环境并安装开发依赖。每次开始新任务前更新主分支，再创建功能分支；完成后执行测试：

```sh
git add app tests README.md
git commit -m "Describe the change"
git push -u origin feature/your-task
```

随后在 GitHub 发起 Pull Request，由队友检查后合并。不要提交 `.venv`、密码、Token、`.env` 或个人文件。按实际改动选择 `git add` 的文件。

后续可以按 `app/main.py`（服务器）与 `app/static/`（网页）分工。修改消息字段时，同时更新前端和测试，并在 Pull Request 中写明新字段或行为。

现有移动规则位于 `app/game.py`，新增游戏逻辑时应由服务器检查玩家命令，再为每位玩家生成允许看到的状态；隐藏舰种不可发给对手后仅在页面遮挡。运行全部测试后再提交阶段或规则修改。
