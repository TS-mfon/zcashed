# ZCashed Escrow — GenLayer Intelligent Contract
# Deploy on GenLayer Studionet: https://studio.genlayer.com
# Docs: https://docs.genlayer.com/developers/intelligent-contracts/introduction

from genlayer import IContract
from genlayer.std import eq_principle_strict_eq


class ZCashedEscrow(IContract):
    """
    AI-judged escrow contract for the ZCashed freelance platform.
    When a worker submits their work, GenLayer's AI validators evaluate
    whether the submission meets the task requirements and reach consensus.
    If approved, the escrow releases the ZEC payment to the worker.
    """

    task_title: str
    task_description: str
    budget_zec: str
    client_address: str
    worker_address: str
    escrow_zcash_address: str
    current_submission: str
    status: str  # open|in_progress|under_review|approved|needs_revision|completed
    rejection_reason: str
    submission_count: int
    payment_tx_hash: str

    def __init__(
        self,
        task_title: str,
        task_description: str,
        budget_zec: str,
        client_address: str,
        escrow_zcash_address: str,
    ) -> None:
        self.task_title = task_title
        self.task_description = task_description
        self.budget_zec = budget_zec
        self.client_address = client_address
        self.escrow_zcash_address = escrow_zcash_address
        self.worker_address = ""
        self.current_submission = ""
        self.status = "open"
        self.rejection_reason = ""
        self.submission_count = 0
        self.payment_tx_hash = ""

    def accept_job(self, worker_address: str) -> None:
        assert self.status == "open", "Job is not open for acceptance"
        assert worker_address != self.client_address, "Client cannot be the worker"
        self.worker_address = worker_address
        self.status = "in_progress"

    def submit_work(self, submission_content: str, worker_address: str) -> None:
        assert self.status in [
            "in_progress",
            "needs_revision",
        ], f"Cannot submit in current status: {self.status}"

        self.current_submission = submission_content
        self.submission_count += 1
        self.status = "under_review"

        # --- AI Evaluation via GenLayer Validator Consensus ---
        # Each validator independently runs this code with an LLM.
        # Validators must reach consensus on the boolean result.

        # Step 1: Check relevance — is this submission even about the task?
        is_relevant = eq_principle_strict_eq(
            f"""You are evaluating a freelance work submission.

TASK TITLE: {self.task_title}
TASK REQUIREMENTS: {self.task_description}
SUBMISSION: {submission_content}

Is this submission relevant and directly related to the described task?
Answer with exactly one word: yes or no""",
            "yes",
        )

        if not is_relevant:
            self.status = "needs_revision"
            self.rejection_reason = (
                "Your submission does not appear to be relevant to this task. "
                "Please submit work that directly addresses the task requirements."
            )
            return

        # Step 2: Check completeness — does it cover all requirements?
        is_complete = eq_principle_strict_eq(
            f"""You are evaluating a freelance work submission.

TASK TITLE: {self.task_title}
TASK REQUIREMENTS: {self.task_description}
SUBMISSION: {submission_content}

Does this submission fully and completely address all the stated requirements?
Consider whether all aspects of the task description have been fulfilled.
Answer with exactly one word: yes or no""",
            "yes",
        )

        if not is_complete:
            self.status = "needs_revision"
            self.rejection_reason = (
                "The submission is incomplete. Not all requirements have been addressed. "
                "Please review every point in the task description and ensure each is covered."
            )
            return

        # Step 3: Check quality — is the work professionally done?
        is_quality = eq_principle_strict_eq(
            f"""You are evaluating a freelance work submission for professional quality.

TASK TITLE: {self.task_title}
TASK REQUIREMENTS: {self.task_description}
SUBMISSION: {submission_content}

Is the quality of this work acceptable for professional standards?
Consider thoroughness, clarity, accuracy, and professionalism.
Answer with exactly one word: yes or no""",
            "yes",
        )

        if not is_quality:
            self.status = "needs_revision"
            self.rejection_reason = (
                "The quality of work does not meet professional standards. "
                "Please revise your submission to improve thoroughness, clarity, and accuracy."
            )
            return

        # All checks passed — work is approved
        self.status = "approved"
        self.rejection_reason = ""

    def mark_paid(self, tx_hash: str) -> None:
        assert self.status == "approved", "Can only mark approved work as paid"
        self.status = "completed"
        self.payment_tx_hash = tx_hash

    def cancel_job(self) -> None:
        assert self.status in ["open", "in_progress"], "Cannot cancel at this stage"
        self.status = "cancelled"

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
            "submission_count": self.submission_count,
            "payment_tx_hash": self.payment_tx_hash,
        }
