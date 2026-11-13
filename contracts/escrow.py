# { "Depends": "py-genlayer:1jb45aa8ynh2a9c9xn3b7qqh8sm5q93hwfp7jqmwsfhh8jpz09h6" }
# ZCashed Escrow — GenLayer Intelligent Contract
# One instance per job. AI validators judge whether a worker's submission
# satisfies the task, reaching consensus before the Zcash escrow is released.

from genlayer import *
import json

ERROR_LLM = "[LLM_ERROR]"
ERROR_EXPECTED = "[EXPECTED]"


class ZCashedEscrow(gl.Contract):
    # ---- Storage (class-level annotations = persisted slots) ----
    task_title: str
    task_description: str
    budget_zec: str
    client_address: str
    worker_address: str
    escrow_zcash_address: str
    current_submission: str
    status: str
    rejection_reason: str
    submission_count: u256
    payment_tx_hash: str

    def __init__(
        self,
        task_title: str,
        task_description: str,
        budget_zec: str,
        client_address: str,
        escrow_zcash_address: str,
    ):
        self.task_title = task_title
        self.task_description = task_description
        self.budget_zec = budget_zec
        self.client_address = client_address
        self.escrow_zcash_address = escrow_zcash_address
        self.worker_address = ""
        self.current_submission = ""
        self.status = "open"
        self.rejection_reason = ""
        self.submission_count = u256(0)
        self.payment_tx_hash = ""

    # ---------- Views ----------
    @gl.public.view
    def get_state(self) -> dict:
        return {
            "task_title": self.task_title,
            "task_description": self.task_description,
            "budget_zec": self.budget_zec,
            "client_address": self.client_address,
            "worker_address": self.worker_address,
            "escrow_zcash_address": self.escrow_zcash_address,
            "current_submission": self.current_submission,
            "status": self.status,
            "rejection_reason": self.rejection_reason,
            "submission_count": str(self.submission_count),
            "payment_tx_hash": self.payment_tx_hash,
        }

    # ---------- Writes ----------
    @gl.public.write
    def accept_job(self, worker_address: str) -> None:
        if self.status != "open":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Job is not open")
        self.worker_address = worker_address
        self.status = "in_progress"

    @gl.public.write
    def submit_work(self, submission_content: str, worker_address: str) -> dict:
        if self.status not in ("in_progress", "needs_revision"):
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Cannot submit in status {self.status}")

        self.current_submission = submission_content
        self.submission_count += u256(1)

        task_title = self.task_title
        task_description = self.task_description

        def judge() -> str:
            prompt = f"""You are an impartial senior reviewer judging freelance work for payment release.

TASK TITLE: {task_title}

TASK REQUIREMENTS:
{task_description}

WORKER SUBMISSION:
{submission_content}

Judge the submission on relevance, completeness, and professional quality.
If it satisfies the requirements, verdict is "approved".
Otherwise verdict is "needs_revision" and explain what must be fixed.

Respond ONLY with a JSON object of this exact shape:
{{"verdict": "approved" or "needs_revision", "reason": "one concise sentence"}}"""

            raw = gl.nondet.exec_prompt(prompt, response_format="json")
            data = _parse_json(raw)
            verdict = str(data.get("verdict", "")).strip().lower()
            if verdict not in ("approved", "needs_revision"):
                raise gl.vm.UserError(f"{ERROR_LLM} Invalid verdict: {verdict}")
            reason = str(data.get("reason", "")).strip()
            return json.dumps({"verdict": verdict, "reason": reason}, sort_keys=True)

        result_str = gl.eq_principle.prompt_comparative(
            judge,
            principle=(
                "The 'verdict' field must be exactly the same (approved or needs_revision). "
                "The 'reason' may be phrased differently but must express the same judgment."
            ),
        )
        result = json.loads(result_str)

        if result.get("verdict") == "approved":
            self.status = "approved"
            self.rejection_reason = ""
        else:
            self.status = "needs_revision"
            self.rejection_reason = result.get("reason", "Work did not meet the requirements.")

        return result

    @gl.public.write
    def mark_paid(self, tx_hash: str) -> None:
        if self.status != "approved":
            raise gl.vm.UserError(f"{ERROR_EXPECTED} Only approved work can be marked paid")
        self.status = "completed"
        self.payment_tx_hash = tx_hash


def _parse_json(raw) -> dict:
    if isinstance(raw, dict):
        return raw
    text = str(raw)
    first = text.find("{")
    last = text.rfind("}")
    if first == -1 or last == -1:
        raise gl.vm.UserError(f"{ERROR_LLM} No JSON object in LLM output")
    return json.loads(text[first : last + 1])
